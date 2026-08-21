import * as jose from 'jose';

export const config = { runtime: 'edge' };

// ---------- GOOGLE OAUTH2 TOKEN GENERATOR (Firestore Admin Access) ----------
async function getGoogleAuthToken(email, privateKeyPEM) {
    try {
        const cleanKey = privateKeyPEM
            .replace(/\\n/g, '\n')
            .replace('-----BEGIN PRIVATE KEY-----', '')
            .replace('-----END PRIVATE KEY-----', '')
            .replace(/\s/g, '');

        const binaryKey = Uint8Array.from(atob(cleanKey), c => c.charCodeAt(0));
        const cryptoKey = await crypto.subtle.importKey(
            'pkcs8',
            binaryKey,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
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
        const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

        const jwt = `${header}.${payload}.${signature}`;

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
        });

        const tokenData = await tokenRes.json();
        return tokenData.access_token;
    } catch (err) {
        throw new Error('OAuth Signing Error: ' + err.message);
    }
}

// ---------- FIREBASE ID TOKEN VERIFICATION (JOSE JWKS) ----------
const JWKS = jose.createRemoteJWKSet(
    new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

async function verifyFirebaseToken(idToken) {
    try {
        const { payload } = await jose.jwtVerify(idToken, JWKS, {
            audience: 'harvion-labs-51ca1',
            issuer: 'https://securetoken.google.com/harvion-labs-51ca1'
        });
        return payload.sub; // Firebase UID
    } catch (err) {
        throw new Error('Invalid Firebase token');
    }
}

export default async function handler(req) {
    try {
        // 1. SHIELD CHECK
        const shieldKey = req.headers.get('x-harvion-shield-key');
        if (shieldKey !== 'HarvionQuantumLabsEngineCoreSecret2026') {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        // 2. BODY PARSE
        let rawBody;
        try {
            rawBody = await req.json();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
        }

        // 3. JWT VERIFY
        const authHeader = req.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ error: 'Login required' }), { status: 401 });
        }
        const idToken = authHeader.split('Bearer ')[1];

        let authenticatedUserId;
        try {
            authenticatedUserId = await verifyFirebaseToken(idToken);
        } catch (e) {
            return new Response(JSON.stringify({ error: 'Invalid token', details: e.message }), { status: 403 });
        }

        // 4. FIRESTORE ROLE CHECK (Server Admin Token)
        const saEmail = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
        const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
        if (!saEmail || !saKey) {
            return new Response(JSON.stringify({ error: 'Server credentials missing' }), { status: 500 });
        }

        const serverAdminToken = await getGoogleAuthToken(saEmail, saKey);
        const encodedUserId = encodeURIComponent(authenticatedUserId);
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/harvion-labs-51ca1/databases/(default)/documents/users/${encodedUserId}`;

        let isPremium = false;
        const firestoreRes = await fetch(firestoreUrl, {
            headers: { 'Authorization': `Bearer ${serverAdminToken}` }
        });

        if (firestoreRes.ok) {
            const userData = await firestoreRes.json();
            const role = (userData.fields?.role?.stringValue || '').toLowerCase();
            isPremium = ['owner', 'archon', 'apex', 'premium'].some(r => role.includes(r));
        }

        if (!isPremium) {
            return new Response(JSON.stringify({ error: 'Canvas Pro only for premium users' }), { status: 403 });
        }

        // 5. PROMPT CHECK
        const userPrompt = rawBody.prompt;
        if (!userPrompt || !userPrompt.trim()) {
            return new Response(JSON.stringify({ error: 'Prompt missing' }), { status: 400 });
        }

        // 6. HF TOKEN CHECK
        const hfApiKey = process.env.HF_TOKEN;
        if (!hfApiKey) {
            return new Response(JSON.stringify({ error: 'HF token missing' }), { status: 500 });
        }

        // 7. IMAGE GENERATION (SDXL)
        const hfResponse = await fetch(
            'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${hfApiKey}`,
                    'Content-Type': 'application/json',
                    'X-Wait-For-Model': 'true'
                },
                body: JSON.stringify({
                    inputs: userPrompt,
                    parameters: {
                        num_inference_steps: 25,
                        guidance_scale: 7.5
                    }
                })
            }
        );

        if (!hfResponse.ok) {
            const errText = await hfResponse.text();
            return new Response(JSON.stringify({ error: 'HuggingFace error', details: errText }), { status: 502 });
        }

        const contentType = hfResponse.headers.get('content-type') || 'image/png';
        if (contentType.includes('application/json')) {
            const errJson = await hfResponse.json();
            return new Response(JSON.stringify({ error: 'HF returned JSON', details: errJson }), { status: 502 });
        }

        // 8. BASE64 CONVERSION
        const arrayBuffer = await hfResponse.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
            return new Response(JSON.stringify({ error: 'Empty image' }), { status: 502 });
        }

        let base64Image;
        if (typeof Buffer !== 'undefined') {
            base64Image = Buffer.from(arrayBuffer).toString('base64');
        } else {
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            base64Image = btoa(binary);
        }

        return new Response(
            JSON.stringify({ imageUrl: `data:${contentType};base64,${base64Image}` }),
            { status: 200 }
        );
    } catch (error) {
        return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', details: error.message }), { status: 500 });
    }
}
