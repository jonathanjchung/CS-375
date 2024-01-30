function login() {
    let username = document.getElementById('username').value;
    let password = document.getElementById('password').value;
    let message = document.getElementById("error-message");

    fetch('/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({username: username, password: password}),
    })
    .then(response => {
        if (response.ok) {
            window.location.href = '/feed.html';
        } else {
            console.error('Login failed');
            message.textContent = "Login failed";
        }
    })
    .catch(error => console.error('Error:', error));
}