// ==========================================
// HARVION CORE INFRASTRUCTURE SYNCHRONIZER
// ==========================================

// 1. Global Firebase Configuration Matrix
const firebaseConfig = {
    apiKey: "AIzaSyCUSuCzsmvcHZy2YJq8G-Xhbs-A9Iy1Tn8",
    authDomain: "harvion-labs-51ca1.firebaseapp.com",
    projectId: "harvion-labs-51ca1",
    storageBucket: "harvion-labs-51ca1.firebasestorage.app",
    messagingSenderId: "908526936420",
    appId: "1:908526936420:web:94fd6c29a53375a4175a71"
};

// Initialize Firebase Core Engines
firebase.initializeApp(firebaseConfig);
const authEngine = firebase.auth();
const firestoreDb = firebase.firestore();

// 2. Centralized Custom Alert Overlay Controller
function showCustomAlert(msg) {
    const overlay = document.getElementById('hv-custom-alert-overlay');
    if (overlay) {
        document.getElementById('hv-alert-text').innerText = msg;
        overlay.style.display = 'flex';
        setTimeout(() => { overlay.style.opacity = '1'; }, 10);
    }
}

function closeCustomAlert() {
    const overlay = document.getElementById('hv-custom-alert-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
    }
}

// 3. Global Password Reset Link Pipeline
// Global Password Reset Link Pipeline
// auth-core.js me purane function ki jagah ye naya block dalein
function executeFirebasePasswordResetLink() {
    const emailElement = document.getElementById('forgot-email-input');
    if (!emailElement) {
        showCustomAlert("Mainframe configuration fault: Input field template not found.");
        return;
    }
    
    const email = emailElement.value.trim();
    if(!email) { 
        showCustomAlert("Please enter your registered email address."); 
        return; 
    }
    
    authEngine.sendPasswordResetEmail(email)
        .then(() => {
            showCustomAlert("Reset link dispatched safely. Check your inbox.");
            if (typeof switchAuthStep === 'function') {
                switchAuthStep('auth-login-step');
            }
        }).catch((err) => {
            showCustomAlert(err.message);
        });
}
