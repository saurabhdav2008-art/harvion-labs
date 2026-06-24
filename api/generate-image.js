export const config = { runtime: 'edge' };

// Google OAuth2 Access Token जनरेटर (फायरस्टोर के लिए)
async function getGoogleAuthToken(email, privateKeyPEM) {
    const cleanKey = privateKeyPEM
        .replace(/\\n/g, '\n')
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\s/g, '');
    const binaryKey = Uint8Array.from(atob(cleanKey), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8', binaryKey,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false, ['sign']
    );
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const now = Math.floor(Date.now() / 1000);
    const payload = btoa(JSON.stringify({
        iss: email,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const message = new TextEncoder().encode(`${header}.${payload}`);
    const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, message);
    const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const jwt = `${header}.${payload}.${signature}`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const tokenData = await tokenRes.json();
    return tokenData.access_token;
}

// Firebase ID Token को verify करने का सिंपल तरीका (Google endpoint से)
async function verifyFirebaseToken(idToken) {
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) {
        throw new Error('FIREBASE_API_KEY is not set on server');
    }
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
    });
    const data = await res.json();
    if (!res.ok) {
        // Google का असली एरर मैसेज लौटाएँ
        throw new Error(data.error?.message || 'Google token verification failed');
    }
    if (data.users && data.users.length > 0) {
        return data.users[0].localId; // uid
    }
    throw new Error('Token valid but no user found');
}

export default async function handler(req) {
    try {
        // Shield चेक
        const shieldKey = req.headers.get('x-harvion-shield-key');
        if (shieldKey !== 'HarvionQuantumLabsEngineCoreSecret2026') {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }

        let rawBody;
        try { rawBody = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

        const authHeader = req.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ error: 'Login required' }), { status: 401 });
        }
        const idToken = authHeader.split('Bearer ')[1];

        // JWT verify बिना jose के
        let authenticatedUserId;
        try {
            authenticatedUserId = await verifyFirebaseToken(idToken);
        } catch (e) {
            return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403 });
        }

        // Firestore से role चेक
        const serviceAccountEmail = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
        const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
        if (!serviceAccountEmail || !serviceAccountKey) {
            return new Response(JSON.stringify({ error: 'Server credentials missing' }), { status: 500 });
        }
        const serverAdminToken = await getGoogleAuthToken(serviceAccountEmail, serviceAccountKey);
        const encodedUserId = encodeURIComponent(authenticatedUserId);
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/harvion-labs-51ca1/databases/(default)/documents/users/${encodedUserId}`;
        let isPremium = false;
        const firestoreRes = await fetch(firestoreUrl, { headers: { 'Authorization': `Bearer ${serverAdminToken}` } });
        if (firestoreRes.ok) {
            const userData = await firestoreRes.json();
            const role = (userData.fields?.role?.stringValue || '').toLowerCase();
            isPremium = ['owner','archon','apex','premium'].some(r => role.includes(r));
        }

        if (!isPremium) {
            return new Response(JSON.stringify({ error: 'Premium only' }), { status: 403 });
        }

        // बाकी हगिंगफेस इमेज जनरेशन (वैसे ही)
        const userPrompt = rawBody.prompt;
        if (!userPrompt) return new Response(JSON.stringify({ error: 'Prompt missing' }), { status: 400 });
        const hfApiKey = process.env.HF_TOKEN;
        if (!hfApiKey) return new Response(JSON.stringify({ error: 'HF token missing' }), { status: 500 });

        const hfResponse = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${hfApiKey}`, 'Content-Type': 'application/json', 'X-Wait-For-Model': 'true' },
            body: JSON.stringify({ inputs: userPrompt, parameters: { num_inference_steps: 4, guidance_scale: 0.0 } })
        });

        if (!hfResponse.ok) {
            const errText = await hfResponse.text();
            return new Response(JSON.stringify({ error: 'HF error', details: errText }), { status: 502 });
        }

        const contentType = hfResponse.headers.get('content-type') || 'image/png';
        if (contentType.includes('application/json')) {
            const errJson = await hfResponse.json();
            return new Response(JSON.stringify({ error: 'HF returned JSON', details: errJson }), { status: 502 });
        }

        const arrayBuffer = await hfResponse.arrayBuffer();
        let base64Image;
        if (typeof Buffer !== 'undefined') {
            base64Image = Buffer.from(arrayBuffer).toString('base64');
        } else {
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            base64Image = btoa(binary);
        }
        return new Response(JSON.stringify({ imageUrl: `data:${contentType};base64,${base64Image}` }), { status: 200 });
    } catch (error) {
        return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', details: error.message }), { status: 500 });
    }
}
