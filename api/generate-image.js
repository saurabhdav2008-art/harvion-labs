import * as jose from 'jose';

export const config = { runtime: 'edge' };

const JWKS = jose.createRemoteJWKSet(
    new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

function uint8ArrayToBase64(bytes) {
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let result = "";
    const len = bytes.length;
    for (let i = 0; i < len; i += 3) {
        const b1 = bytes[i];
        const b2 = i + 1 < len ? bytes[i + 1] : 0;
        const b3 = i + 2 < len ? bytes[i + 2] : 0;
        result += abc[b1 >> 2];
        result += abc[((b1 & 3) << 4) | (b2 >> 4)];
        result += i + 1 < len ? abc[((b2 & 15) << 2) | (b3 >> 6)] : "=";
        result += i + 2 < len ? abc[b3 & 63] : "=";
    }
    return result;
}

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        // ✅ STEP 1 — Body PEHLE padh lo (stream sirf ek baar padhti hai)
        let rawBody;
        try {
            rawBody = await req.json();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
                status: 400, headers: { 'Content-Type': 'application/json' }
            });
        }

        // 🛡️ STEP 2 — Shield Key check
        const shieldKey = req.headers.get('x-harvion-shield-key');
        if (shieldKey !== process.env.HARVION_SHIELD_KEY) {
            return new Response(JSON.stringify({
                error: 'SECURITY_FAULT: Unauthorized.'
            }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }

        // 🛡️ STEP 3 — Login mandatory check
        const authHeader = req.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader === 'Bearer ') {
            return new Response(JSON.stringify({
                error: 'Canvas Pro ke liye login required hai.'
            }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }

        // 🛡️ STEP 4 — JWT Token verify
        const rawToken = authHeader.split('Bearer ')[1];
        let authenticatedUserId = null;
        try {
            const { payload } = await jose.jwtVerify(rawToken, JWKS, {
                audience: 'harvion-labs-51ca1',
                issuer: 'https://securetoken.google.com/harvion-labs-51ca1'
            });
            authenticatedUserId = payload.sub;
        } catch (jwtError) {
            return new Response(JSON.stringify({
                error: 'SECURITY_FAULT: Invalid token.'
            }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // 🛡️ STEP 5 — Firestore se role check (REST API)
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/harvion-labs-51ca1/databases/(default)/documents/users/${authenticatedUserId}`;
        const firestoreRes = await fetch(firestoreUrl, {
            headers: { 'Authorization': `Bearer ${rawToken}` }
        });

        if (!firestoreRes.ok) {
            return new Response(JSON.stringify({
                error: 'User data fetch failed.'
            }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        const firestoreData = await firestoreRes.json();
        const userRole = firestoreData?.fields?.role?.stringValue || '';
        const allowedRoles = ['owner', 'premium', 'apex', 'archon'];
        const isPremium = allowedRoles.some(r => userRole.toLowerCase().includes(r));

        if (!isPremium) {
            return new Response(JSON.stringify({
                error: 'Canvas Pro sirf Premium users ke liye hai.'
            }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // ✅ STEP 6 — Prompt check (body upar se already pada hua hai)
        const userPrompt = rawBody.prompt;
        if (!userPrompt || userPrompt.trim() === '') {
            return new Response(JSON.stringify({
                error: 'Prompt missing hai.'
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // ✅ STEP 7 — HF Token check
        const hfApiKey = process.env.HF_TOKEN;
        if (!hfApiKey) {
            return new Response(JSON.stringify({
                error: 'HF Token missing hai server pe.'
            }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        // 🎨 STEP 8 — Image generate karo
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
            let errJson = {};
            try { errJson = JSON.parse(errText); } catch (_) {}
            if (hfResponse.status === 503) {
                return new Response(JSON.stringify({
                    error: 'Model load ho raha hai, 20 second baad retry karo.',
                    details: errJson
                }), { status: 503, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify({
                error: 'HuggingFace error.',
                details: errJson
            }), { status: 502, headers: { 'Content-Type': 'application/json' } });
        }

        // JSON aaya matlab error hai — image nahi
        const contentType = hfResponse.headers.get('content-type') || 'image/png';
        if (contentType.includes('application/json')) {
            const errJson = await hfResponse.json();
            return new Response(JSON.stringify({
                error: 'HF ne image ki jagah JSON diya.',
                details: errJson
            }), { status: 502, headers: { 'Content-Type': 'application/json' } });
        }

        // STEP 9 — Base64 convert
        const arrayBuffer = await hfResponse.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        if (bytes.length === 0) {
            return new Response(JSON.stringify({
                error: 'Empty image response.'
            }), { status: 502, headers: { 'Content-Type': 'application/json' } });
        }

        const base64Image = uint8ArrayToBase64(bytes);
        const finalImageUrl = `data:${contentType};base64,${base64Image}`;

        return new Response(JSON.stringify({ imageUrl: finalImageUrl }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        });
    }
}
