let signup = document.getElementById("submit");
let message = document.getElementById("error-message");

let usernameInput = document.getElementById("username");
let passwordInput = document.getElementById("password");
let confirmPassword = document.getElementById("confirmPassword");

signup.addEventListener("click", () => {
    fetch("/signup", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: usernameInput.value,
            plaintextPassword: passwordInput.value,
            confirmPassword: confirmPassword.value
        })
    }).then((response) => {
        if (response.status === 200) {
            window.location.href = "/index.html";
        } else {
            message.textContent = "Account creation failed";
        }
    });
});