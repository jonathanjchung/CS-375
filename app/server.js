let express = require("express");
let path = require("path");
let pg = require("pg");
let bcrypt = require("bcrypt");
let request = require("request");
let crypto = require("crypto");
let cors = require("cors");
let querystring = require("querystring");
let cookieParser = require("cookie-parser");
let ejs = require("ejs");
let axios = require('axios');

let env = require("../env.json");

let client_id = env.CLIENT_ID;
let client_secret = env.CLIENT_SECRET;
let redirect_uri = env.REDIRECT_URI;

let generateRandomString = (length) => {
  return crypto.randomBytes(60).toString("hex").slice(0, length);
};

let stateKey = "spotify_auth_state";
let app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app
  .use(express.static(__dirname + "/public"))
  .use(cors())
  .use(cookieParser());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

let port = 3000;
let hostname = "localhost";

let { response } = require("express");
let { parseArgs } = require("util");
let Pool = pg.Pool;
let pool = new Pool(env);
pool.connect().then(function () {
  console.log(`Connected to database ${env.database}`);
});

app.get("/", (req, res) => {
    res.clearCookie("id");
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", function (req, res) {
  let state = generateRandomString(16);
  res.cookie(stateKey, state);

  let scope = "user-read-private user-read-email user-top-read";
  res.redirect(
    "https://accounts.spotify.com/authorize?" +
      querystring.stringify({
        response_type: "code",
        client_id: client_id,
        scope: scope,
        redirect_uri: redirect_uri,
        state: state,
      })
  );
});

app.get("/callback", function (req, res) {
  // application requests refresh and access tokens
  // after checking the state parameter

  let code = req.query.code || null;
  let state = req.query.state || null;
  let storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    res.redirect(
      "/#" +
        querystring.stringify({
          error: "state_mismatch",
        })
    );
  } else {
    res.clearCookie(stateKey);
    let authOptions = {
      url: "https://accounts.spotify.com/api/token",
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: "authorization_code",
      },
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          new Buffer.from(client_id + ":" + client_secret).toString("base64"),
      },
      json: true,
    };

    request.post(authOptions, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        let access_token = body.access_token;
        let refresh_token = body.refresh_token;

        // Use the access token to get user details
        let options = {
          url: "https://api.spotify.com/v1/me",
          headers: { Authorization: "Bearer " + access_token },
          json: true,
        };

        request.get(options, async function (error, response, userBody) {
          if (!error && response.statusCode === 200) {
            // Save user details and access token to the database
            try {
              let result = await pool.query(
                "INSERT INTO accountinfo (spotify_id, display_name, access_token, refresh_token) VALUES ($1, $2, $3, $4) ON CONFLICT (spotify_id) DO NOTHING RETURNING *",
                [
                  userBody.id,
                  userBody.display_name,
                  access_token,
                  refresh_token,
                ]
              );
              //console.log(userBody);
              res.cookie("id", userBody.id);
              //res.render("feed", { user: userBody });
              res.redirect("/timeline");
            } catch (dbError) {
              console.error(
                "Error saving user details to the database:",
                dbError
              );
              res.redirect(
                "/#" +
                  querystring.stringify({
                    error: "db_error",
                  })
              );
            }
          } else {
            res.redirect(
              "/#" +
                querystring.stringify({
                  error: "invalid_user_data",
                })
            );
          }
        });
      } else {
        res.redirect(
          "/#" +
            querystring.stringify({
              error: "invalid_token",
            })
        );
      }
    });
  }
});

app.get("/refresh_token", function (req, res) {
    let refresh_token = req.query.refresh_token;
    let authOptions = {
      url: "https://accounts.spotify.com/api/token",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          new Buffer.from(client_id + ":" + client_secret).toString("base64"),
      },
      form: {
        grant_type: "refresh_token",
        refresh_token: refresh_token,
      },
      json: true,
    };
  
    request.post(authOptions, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        let access_token = body.access_token,
          refreshed_refresh_token = body.refresh_token;
  
        pool.query(
          "UPDATE accountinfo SET access_token = $1 WHERE refresh_token = $2",
          [access_token, refresh_token],
          (err, result) => {
            if (err) {
              console.error("Error updating access token:", err);
              res.status(500).send("Internal Server Error");
            } else {
              res.send({
                access_token: access_token,
                refresh_token: refreshed_refresh_token,
              });
            }
          }
        );
      } else {
        res.status(response.statusCode).send({ error: "Invalid refresh token" });
      }
    });
});  

async function refreshAccessToken(refreshToken) {
    return new Promise((resolve, reject) => {
      request.get(
        `http://localhost:3000/refresh_token?refresh_token=${refreshToken}`,
        (error, response, body) => {
          if (!error && response.statusCode === 200) {
            let newTokens = JSON.parse(body);
            // Handle new tokens - update your current token with new access_token
            resolve(newTokens.access_token);
          } else {
            reject(error || body);
          }
        }
      );
    });
}

async function checkAccessTokenValidity(accessToken) {
    try {
      let response = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
  
      if (!response.ok) {
        throw new Error('Invalid access token');
      }
  
      let userData = await response.json();
      return userData;
    } catch (error) {
      console.error('Error checking access token validity:', error.message);
      throw error;
    }
}  

// If you want to test or refresh your access token validity, uncomment this and replace token strings
/*
let expiredToken = 'BQAd15c178tbyxlTnuzHWFeRaB_OeZ-bkjedVIOVWg5nRkx0z5yUB9LCp8B-Covxia-9eSskYMidKOllXF92pnq-pcgH9NiNo_03o_0InjEX-Jj2aufUlwcYYxIsN3nwcy9y1P9LfsH_KQqw5wK4zQqK2MLRMHmm9R4zr5DKInHavGMsxFW00ArlJ8J5mA';
let refreshToken = 'AQCcR6arKLXEPB4nTU-GDBVtTzdaa0niDk50n2Oe-HNcGrabwI-m0IMGv1Lr_dpDIx1jF-YD1NYwNr-WOE4FJycqBZzq3KAaAoDgrPrTy-2lLNmo5rGqwqEp3ohbgjLO59c';

// Check the token validity or expiration
checkAccessTokenValidity(expiredToken)
.then(() => {
    console.log('Access token is valid');
    refreshAccessToken(refreshToken)
    .then((newAccessToken) => {
        console.log('Refreshed access token:', newAccessToken);
    })
    .catch((refreshError) => {
        console.error('Error refreshing access token:', refreshError);
    });
})
.catch(() => {
    console.log('Access token is invalid or expired');
    refreshAccessToken(refreshToken)
    .then((newAccessToken) => {
        console.log('Refreshed access token:', newAccessToken);
    })
    .catch((refreshError) => {
        console.error('Error refreshing access token:', refreshError);
    });
});
*/

async function fetchTokensFromDatabase() {
    try {
      let result = await pool.query('SELECT access_token, refresh_token FROM accountinfo LIMIT 1');
      if (result.rows.length > 0) {
        let { access_token, refresh_token } = result.rows[0];
        return { expiredToken: access_token, refreshToken: refresh_token };
      }
      throw new Error('Tokens not found in the database');
    } catch (error) {
      throw error;
    }
  }

fetchTokensFromDatabase()
.then(tokens => {
    let expiredToken = tokens.expiredToken;
    let refreshToken = tokens.refreshToken;

    checkAccessTokenValidity(expiredToken)
    .then(() => {
        console.log('Access token is valid');
    })
    .catch(() => {
        console.log('Access token is invalid or expired');
        refreshAccessToken(refreshToken)
        .then(newAccessToken => {
            console.log('Refreshed access token:', newAccessToken);
        })
        .catch(refreshError => {
            console.error('Error refreshing access token:', refreshError);
        });
    });
})
.catch(error => {
    console.error('Error fetching tokens from the database:', error);
});

async function getUserDetailsFromDatabase(userId) {
    try {
        let queryResult = await pool.query(
            "SELECT * FROM accountinfo WHERE spotify_id = $1",
            [userId]
        );

        if (queryResult.rows.length > 0) {
            return queryResult.rows[0];
        } else {
            throw new Error("User not found");
        }
    } catch (error) {
        throw error;
    }
}

async function fetchUserProfilePicture(accessToken) {
    try {
      let options = {
        url: "https://api.spotify.com/v1/me",
        headers: { Authorization: `Bearer ${accessToken}` },
      };
  
      let response = await axios.get(options.url, { headers: options.headers });

      if (response && response.data && response.data.images && response.data.images.length > 0) {
        return response.data.images[1].url;
      } else {
        return "URL_TO_DEFAULT_IMAGE";
      }
    } catch (error) {
      console.error("Error fetching profile picture:", error);
      throw error;
    }
}

async function fetchTopArtists(accessToken) {
    try {
        let response = await axios.get("https://api.spotify.com/v1/me/top/artists", {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        return response.data.items;
    } catch (error) {
        throw error;
    }
}

async function fetchTopTracks(accessToken) {
    try {
        let response = await axios.get("https://api.spotify.com/v1/me/top/tracks", {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        return response.data.items;
    } catch (error) {
        throw error;
    }
}

app.get("/feed", async (req, res) => {
    try {
        let posts = await pool.query(
          "SELECT spotify_id, post, created_at FROM posts WHERE spotify_id = $1 "
          + "UNION ALL "
          + "SELECT posts.spotify_id, posts.post, posts.created_at FROM posts JOIN followingdata ON posts.spotify_id = followingdata.is_following "
          + "WHERE followingdata.spotify_id = $2 "
          + "ORDER BY created_at DESC", [req.cookies.id, req.cookies.id]
          );
        res.status(200).json(posts.rows);
    } catch (error) {
        console.error("Error fetching posts:", error);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/timeline", async (req, res) => {
    try {
        let userId = req.cookies.id;
        
        let queryResult = await pool.query(
            "SELECT access_token, spotify_id FROM accountinfo WHERE spotify_id = $1",
            [userId]
        );
        
        if (queryResult.rows.length > 0) {
            let { access_token } = queryResult.rows[0];
            
            let profilePicture = await fetchUserProfilePicture(access_token);
            
            let user = await getUserDetailsFromDatabase(userId);
            let userPosts = await pool.query(
                "SELECT spotify_id, post, created_at FROM posts WHERE spotify_id = $1",
                [userId]
            );
            
            res.render("feed", { user, userPosts, profilePicture });
        } else {
            res.status(404).send("Access token not found for the user");
        }
    } catch (error) {
        console.error("Error fetching timeline:", error);
        res.status(500).send("Internal Server Error");
    }
});

app.post("/feed", (req, res) => {
  console.log("POST request body: ", req.body);
  let post = req.body.post;
  console.log(post);

  pool
    .query(
      `INSERT INTO posts (post, spotify_id) 
       VALUES ($1, $2)
       RETURNING *`,
      [post, req.cookies.id]
    )
    .then((result) => {
      res.status(200).send();
      console.log("Inserted:");
      console.log(result.rows);
    })
    .catch((error) => {
      console.log(error);
    });
});

app.get("/profile", async (req, res) => {
    try {
      let userId = req.cookies.id;
      let currentlySignedIn = req.cookies.id;
      
      if (!userId) {
        return res.status(401).send("User not authenticated");
      }
      
      let queryResult = await pool.query(
        "SELECT access_token, spotify_id FROM accountinfo WHERE spotify_id = $1",
        [userId]
        );
        
      if (queryResult.rows.length > 0) {
        let { access_token } = queryResult.rows[0];

        let user = await getUserDetailsFromDatabase(userId);
        let userPosts = await pool.query(
          "SELECT spotify_id, post, created_at FROM posts WHERE spotify_id = $1",
          [userId]
          );
        
        let profilePicture = await fetchUserProfilePicture(access_token);
        let topArtists = await fetchTopArtists(access_token);
        let topTracks = await fetchTopTracks(access_token);

        let followCheck = 0;
        let fcQuery = await pool.query("SELECT COUNT(*) FROM followingdata WHERE spotify_id = $1 AND is_following = $2",
        [currentlySignedIn, userId])
        .then((result) => {
          followCheck = result.rows[0].count;
          //console.log(result.rows[0].count);
        })
        .catch((error) => {
          console.log(error);
        })
        
        res.render("profile", {
          user,
          userPosts,
          currentlySignedIn,
          profilePicture,
          topArtists,
          topTracks,
          followCheck,
        });
      } else {
        res.status(404).send("Access token not found for the user");
      }
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).send("Internal Server Error");
    }
});

app.get("/:profile", async (req, res) => {
  try {
    let userId = req.params.profile;
    let currentlySignedIn = req.cookies.id;
    
    if (!userId) {
      return res.status(401).send("User not authenticated");
    }

    if (userId === currentlySignedIn) {
      res.redirect("/profile");
    }
    else {
      let queryResult = await pool.query(
        "SELECT access_token, spotify_id FROM accountinfo WHERE spotify_id = $1",
        [userId]
        );
        
      if (queryResult.rows.length > 0) {
        let { access_token } = queryResult.rows[0];
  
        let user = await getUserDetailsFromDatabase(userId);
        let userPosts = await pool.query(
          "SELECT spotify_id, post, created_at FROM posts WHERE spotify_id = $1",
          [userId]
          );
        
        let profilePicture = await fetchUserProfilePicture(access_token);
        let topArtists = await fetchTopArtists(access_token);
        let topTracks = await fetchTopTracks(access_token);
        
        let followCheck = 0;
        let fcQuery = await pool.query("SELECT COUNT(*) FROM followingdata WHERE spotify_id = $1 AND is_following = $2",
        [currentlySignedIn, userId])
        .then((result) => {
          followCheck = result.rows[0].count;
          //console.log(result.rows[0].count);
        })
        .catch((error) => {
          console.log(error);
        })
        
        res.render("profile", {
          user,
          userPosts,
          currentlySignedIn,
          profilePicture,
          topArtists,
          topTracks,
          followCheck,
        });
      } else {
        res.status(404).send("Access token not found for the user");
      }
    }
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/follow", (req, res) => {
    let { user, following } = req.body;

    if (user === following) {
        res.send(400);
    }
    if (user === null || following === null) {
        res.send(400);
    }
    else {
        let sql = 'INSERT INTO followingdata(spotify_id, is_following) VALUES($1, $2) RETURNING *'
        let values = [user, following];
        pool.query(sql, values)
        .then((result) => {
            console.log("Inserted:");
            console.log(result.rows);
        })
        .catch((error) => {
            console.log(error);
        });
    }
    res.send();
});

app.listen(port, hostname, () => {
  console.log(`http://${hostname}:${port}`);
});