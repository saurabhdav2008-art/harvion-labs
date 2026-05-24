import * as jose from 'jose';

export const config = { runtime: 'edge' };

const JWKS = jose.createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

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
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        // 🛡️ 1. SHIELD GATE HEADER CHECK
        const shieldKey = req.headers.get('x-harvion-shield-key');
       if (shieldKey !== process.env.HARVION_SHIELD_KEY) {
            return new Response(JSON.stringify({ error: 'SECURITY_FAULT: Unauthorized Core Endpoint Connection Dropped.' }), {
                status: 401, headers: { 'Content-Type': 'application/json' }
            });
        }

        const rawBody = await req.json();
        const authHeader = req.headers.get('Authorization');
        const userPrompt = rawBody.prompt;

        if (!userPrompt) {
            return new Response(JSON.stringify({ error: 'Validation Error: Prompt parameter is missing.' }), { status: 400 });
        }

        // Login MANDATORY hai
if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader === 'Bearer ') {
    return new Response(JSON.stringify({ error: 'Login required for Canvas Proi.' }), { 
        status: 401, headers: { 'Content-Type': 'application/json' } 
    });
}

let authenticatedUserId = null;

if (authHeader && authHeader.startsWith('Bearer ')) {
            const rawToken = authHeader.split('Bearer ')[1];
            try {
                const { payload } = await jose.jwtVerify(rawToken, JWKS, {
                    audience: 'harvion-labs-51ca1',
                    issuer: 'https://securetoken.google.com/harvion-labs-51ca1'
                });
                authenticatedUserId = payload.sub;
            } catch (jwtError) {
                return new Response(JSON.stringify({ error: 'SECURITY_FAULT: Cryptographic Token Tampering Mismatch.' }), {
                    status: 403, headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // 🔑 Hugging Face Key Check
        const hfApiKey = process.env.HF_TOKEN;
        if (!hfApiKey) {
            return new Response(JSON.stringify({ error: 'SERVER_FAULT: Hugging Face API Token Missing.' }), { status: 500 });
        }

        // ✅ FIX 1: wait_for_model: true — model cold start handle karta hai
        const hfResponse = await fetch(
            'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${hfApiKey}`,
                    'Content-Type': 'application/json',
                    'X-Wait-For-Model': 'true'   // ✅ FIX: model warm hone ka wait karo
                },
                body: JSON.stringify({
                    inputs: userPrompt,
                    parameters: {
                        num_inference_steps: 4,   // FLUX schnell ke liye optimal
                        guidance_scale: 0.0       // schnell ko guidance nahi chahiye
                    }
                })
            }
        );

        // ✅ FIX 2: Proper error response padhna
        if (!hfResponse.ok) {
            const errText = await hfResponse.text();
            let errJson = {};
            try { errJson = JSON.parse(errText); } catch (_) {}

            // Model abhi load ho raha hai
            if (hfResponse.status === 503) {
                return new Response(JSON.stringify({ 
                    error: 'Model is loading, please retry in 20 seconds.',
                    details: errJson
                }), { status: 503, headers: { 'Content-Type': 'application/json' } });
            }

            return new Response(JSON.stringify({ 
                error: 'Upstream HuggingFace Error.', 
                status: hfResponse.status,
                details: errJson 
            }), { status: 502, headers: { 'Content-Type': 'application/json' } });
        }

        // ✅ FIX 3: Content-Type se actual format detect karo (PNG vs JPEG)
        const contentType = hfResponse.headers.get('content-type') || 'image/png';

        // ✅ FIX 4: Binary check — agar JSON aaya to error hai image nahi
        if (contentType.includes('application/json')) {
            const errJson = await hfResponse.json();
            return new Response(JSON.stringify({ 
                error: 'HuggingFace returned JSON instead of image.', 
                details: errJson 
            }), { status: 502, headers: { 'Content-Type': 'application/json' } });
        }

        const arrayBuffer = await hfResponse.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        if (bytes.length === 0) {
            return new Response(JSON.stringify({ error: 'Empty image response from model.' }), { status: 502 });
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
