import { createRemoteJWKSet, jwtVerify } from 'jose';

export const config = { runtime: 'edge' };

// Google OAuth2 Access Token जनरेट करने का फंक्शन (Edge-safe)
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
        throw new Error("OAuth Token Generation Failed: " + err.message);
    }
}

export default async function handler(req) {
    // पूरे हैंडलर को try-catch में लपेटें ताकि unexpected crash की जानकारी मिले
    try {
        // ================== स्टेप 1: Shield Key चेक ==================
        const shieldKey = req.headers.get('x-harvion-shield-key');
        if (shieldKey !== 'HarvionQuantumLabsEngineCoreSecret2026') {
            return new Response(JSON.stringify({ error: 'SECURITY_FAULT: Unauthorized.' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ================== स्टेप 2: Body पार्स ==================
        let rawBody;
        try {
            rawBody = await req.json();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ================== स्टेप 3: Auth Token Verify ==================
        const authHeader = req.headers.get('Authorization');
        let authenticatedUserId = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const rawToken = authHeader.split('Bearer ')[1];
            try {
                // JWKS को हैंडलर के अंदर बनाएं (top-level पे नहीं)
                const JWKS = createRemoteJWKSet(
                    new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
                );
                const { payload } = await jwtVerify(rawToken, JWKS, {
                    audience: 'harvion-labs-51ca1',
                    issuer: 'https://securetoken.google.com/harvion-labs-51ca1'
                });
                authenticatedUserId = payload.sub;
            } catch (jwtError) {
                return new Response(JSON.stringify({ error: 'SECURITY_FAULT: Invalid token.' }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        } else {
            return new Response(JSON.stringify({ error: 'Canvas Pro requires login.' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ================== स्टेप 4: Firestore से Role चेक ==================
        const serviceAccountEmail = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
        const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;

        if (!serviceAccountEmail || !serviceAccountKey) {
            return new Response(JSON.stringify({ error: 'Server credentials missing.' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        let serverAdminToken;
        try {
            serverAdminToken = await getGoogleAuthToken(serviceAccountEmail, serviceAccountKey);
        } catch (tokenErr) {
            return new Response(JSON.stringify({ error: 'Failed to generate admin token.', details: tokenErr.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const encodedUserId = encodeURIComponent(authenticatedUserId);
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/harvion-labs-51ca1/databases/(default)/documents/users/${encodedUserId}`;

        let isPremium = false;
        try {
            const firestoreRes = await fetch(firestoreUrl, {
                headers: { 'Authorization': `Bearer ${serverAdminToken}` }
            });

            if (firestoreRes.ok) {
                const userData = await firestoreRes.json();
                const userRole = (userData.fields?.role?.stringValue || '').toLowerCase();
                const allowedRoles = ['owner', 'archon', 'apex', 'premium'];
                isPremium = allowedRoles.some(r => userRole.includes(r));
            } else {
                // User document नहीं मिला, तो premium नहीं है
                isPremium = false;
            }
        } catch (dbError) {
            return new Response(JSON.stringify({ error: 'User data fetch failed.', details: dbError.message }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!isPremium) {
            return new Response(JSON.stringify({ error: 'Canvas Pro sirf Premium users ke liye hai.' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ================== स्टेप 5: Prompt चेक ==================
        const userPrompt = rawBody.prompt;
        if (!userPrompt || userPrompt.trim() === '') {
            return new Response(JSON.stringify({ error: 'Prompt missing hai.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ================== स्टेप 6: HF Token चेक ==================
        const hfApiKey = process.env.HF_TOKEN;
        if (!hfApiKey) {
            return new Response(JSON.stringify({ error: 'HF Token missing hai server pe.' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ================== स्टेप 7: Hugging Face से Image Generate ==================
        const hfResponse = await fetch(
            'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
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
                        num_inference_steps: 4,
                        guidance_scale: 0.0
                    }
                })
            }
        );

        if (!hfResponse.ok) {
            const errText = await hfResponse.text();
            let errDetails = {};
            try { errDetails = JSON.parse(errText); } catch (_) {}
            return new Response(JSON.stringify({ error: 'HuggingFace error.', details: errDetails }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const contentType = hfResponse.headers.get('content-type') || 'image/png';
        if (contentType.includes('application/json')) {
            const errJson = await hfResponse.json();
            return new Response(JSON.stringify({ error: 'HF returned JSON instead of image.', details: errJson }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ================== स्टेप 8: Base64 में बदलें (Safe Method) ==================
        const arrayBuffer = await hfResponse.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
            return new Response(JSON.stringify({ error: 'Empty image response.' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        let base64Image;
        if (typeof Buffer !== 'undefined') {
            // Node.js जैसा environment (Next.js Edge में Buffer होता है)
            base64Image = Buffer.from(arrayBuffer).toString('base64');
        } else {
            // Pure Web API – लूप से बाइनरी स्ट्रिंग बनाएं (stack overflow से बचने के लिए)
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            base64Image = btoa(binary);
        }

        const finalImageUrl = `data:${contentType};base64,${base64Image}`;

        return new Response(JSON.stringify({ imageUrl: finalImageUrl }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        // अगर कोई अनजान एरर आए तो उसका मैसेज ज़रूर भेजें
        return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', details: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
