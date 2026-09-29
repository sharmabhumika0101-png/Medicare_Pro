# Medicare Pro

Medicare Pro is a web-based healthcare management system designed to provide a centralized platform for managing patients, doctors, appointments, departments, pharmacy services, and healthcare-related information.

## Features

* Patient registration and login
* Doctor registration and management
* Doctor and patient profiles
* Appointment management
* Department information
* Pharmacy services
* Patient health information
* Vitals and health monitoring
* User authentication
* Password recovery
* Dashboard for managing healthcare information
* Database integration

## Technologies Used

* **Frontend:** HTML, CSS, JavaScript
* **Backend:** Node.js, Express.js
* **Database:** MongoDB
* **Authentication:** User authentication and session management
* **APIs:** REST API

## Project Structure

```text
medicare-pro/
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   └── server.js
│
├── frontend/
│   ├── appointment.html
│   ├── dashboard.html
│   ├── departments.html
│   ├── doctors.html
│   ├── forgotpassword.html
│   ├── loginpg.html
│   ├── patients.html
│   ├── Pharmacy.html
│   └── vitals-scan.html
│
├── .gitignore
└── README.md
```

## Installation

### 1. Clone the repository

```bash
git clone <your-github-repository-url>
```

### 2. Open the project

```bash
cd medicare-pro
```

### 3. Install backend dependencies

```bash
cd backend
npm install
```

### 4. Configure environment variables

Create a `.env` file inside the `backend` folder and add the required configuration.

Example:

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
```

Do not upload the `.env` file to GitHub.

### 5. Start the backend server

```bash
node server.js
```

The server will start on the configured port.

## Important

The following files and folders should **not** be uploaded to GitHub:

```text
node_modules/
.env
client_secret_*.json
```

Dependencies can be installed using:

```bash
npm install
```

## Future Improvements

* Online appointment booking
* Doctor availability management
* Prescription management
* Medical report management
* Improved security and authentication
* Online pharmacy integration
* Notification and email services

## Project Status

This project is developed as a web-based healthcare management system for academic and development purposes.

## Author

**Bhumika Sharma**

B.Tech Data Science
Usha Mittal Institute of Technology
S.N.D.T. Women's University, Mumbai
