DROP DATABASE IF EXISTS userdata;
CREATE DATABASE userdata;
\c userdata

CREATE TABLE accountinfo (
    id SERIAL PRIMARY KEY,
    spotify_id VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    access_token VARCHAR(255),
    refresh_token VARCHAR(255)
);

CREATE TABLE posts (
	id SERIAL PRIMARY KEY,
	post VARCHAR(250),
    spotify_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT LOCALTIMESTAMP,
    FOREIGN KEY(spotify_id) REFERENCES accountinfo(spotify_id)
);

CREATE TABLE followingdata (
    spotify_id VARCHAR(255) NOT NULL,
    is_following VARCHAR(255) NOT NULL,
    FOREIGN KEY(spotify_id) REFERENCES accountinfo(spotify_id),
    FOREIGN KEY(is_following) REFERENCES accountinfo(spotify_id)
);