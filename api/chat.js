export const config = { runtime: 'edge' };

// 🔐 Helper to decode base64url string natively on Edge
function base64UrlDecode(str) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return JSON.parse(atob(base64));
}

// 🛡️ Pure Web Crypto Firebase Token Verifier (Zero Dependencies - Fixes Vercel Jose Error)
async function verifyFirebaseToken(token, projectId) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [headerStr, payloadStr, signatureStr] = parts;
        const header = base64UrlDecode(headerStr);
        const payload = base64UrlDecode(payloadStr);

        // Standard Token Validation Checks
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp < now) return null;
        if (payload.aud !== projectId) return null;
        if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;

        // Fetch Google's public JWK public certificates array
        const jwksRes = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
        const jwks = await jwksRes.json();

        // Match exact verification signature identifier
        const jwk = jwks.keys.find(k => k.kid === header.kid);
        if (!jwk) return null;

        // Import keys securely via Native Web Crypto Runtime Engine
        const cryptoKey = await crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const encoder = new TextEncoder();
        const data = encoder.encode(`${headerStr}.${payloadStr}`);
        const sigBinary = Uint8Array.from(atob(signatureStr.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

        const isValid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            cryptoKey,
            sigBinary,
            data
        );

        return isValid ? payload : null;
    } catch (err) {
        return null;
    }
}

// Web Crypto API ke through Google OAuth2 Access Token generate karne ka secure function
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
    } catch (err) {
        throw new Error("OAuth Signing Error: " + err.message);
    }
}

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const shieldKey = req.headers.get('x-harvion-shield-key');
        if (shieldKey !== 'HarvionQuantumLabsEngineCoreSecret2026') {
            return new Response(JSON.stringify({ error: 'SECURITY_FAULT: Unauthorized Core Endpoint Connection Dropped.' }), { 
                status: 401, headers: { 'Content-Type': 'application/json' } 
            });
        }

        const rawBody = await req.json();
        const authHeader = req.headers.get('Authorization');
        const requestedIntent = rawBody.mode || 'Pulse Stream';
        
        let authenticatedUserId = null;
        let userRole = "standard beta user";
        let remainingChats = 0;
        let isRealPremium = false;
        let databaseUpdateRequired = false;
        const todayStr = new Date().toISOString().split('T')[0];
        
        // 🛡️ NATIVE SERVER-SIDE TOKEN VERIFICATION (NO EXTERNAL JOSE DEPENDENCY)
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const rawToken = authHeader.split('Bearer ')[1];
            try {
                const payload = await verifyFirebaseToken(rawToken, 'harvion-labs-51ca1');
                if (!payload) throw new Error("Verification Failed");
                authenticatedUserId = payload.sub; 
            } catch (jwtError) {
                return new Response(JSON.stringify({ error: 'SECURITY_FAULT: Cryptographic Token Tampering Mismatch.' }), { 
                    status: 403, headers: { 'Content-Type': 'application/json' } 
                });
            }
        }

        const serviceAccountEmail = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
        const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
        if (!serviceAccountEmail || !serviceAccountKey) {
            return new Response(JSON.stringify({ error: 'SERVER_FAULT: Credentials Infrastructure Missing.' }), { status: 500 });
        }
        const serverAdminToken = await getGoogleAuthToken(serviceAccountEmail, serviceAccountKey);
        
        const firestoreUrl = authenticatedUserId 
            ? `https://firestore.googleapis.com/v1/projects/harvion-labs-51ca1/databases/(default)/documents/users/${authenticatedUserId}`
            : null;

        if (authenticatedUserId && firestoreUrl) {
            const dbCheck = await fetch(firestoreUrl, {
                headers: { 'Authorization': `Bearer ${serverAdminToken}` }
            });
            
            if (dbCheck.ok) {
                const userData = await dbCheck.json();
                userRole = (userData.fields?.role?.stringValue || "Standard Beta User").toLowerCase();
                isRealPremium = ['owner', 'archon', 'apex', 'premium'].some(k => userRole.includes(k));
                
                const lastChatDate = userData.fields?.last_chat_date?.stringValue || "";
                remainingChats = parseInt(userData.fields?.remaining_chats?.integerValue || "0");

                if (lastChatDate !== todayStr && !isRealPremium) {
                    remainingChats = 10; 
                    databaseUpdateRequired = true;
                }
            }
        }

        let incomingMessages = [];
        if (rawBody.contents) {
            incomingMessages = rawBody.contents.map(c => {
                let hasImage = false;
                let contentArray = [];
                let pureText = "";
                
                if (c.parts) {
                    c.parts.forEach(part => {
                        if (part.text) {
                            contentArray.push({ type: "text", text: part.text });
                            pureText += part.text + "\n";
                        }
                        if (part.inlineData) {
                            hasImage = true;
                            contentArray.push({
                                type: "image_url",
                                image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
                            });
                        }
                    });
                }
                return {
                    role: c.role === 'model' ? 'assistant' : 'user',
                    content: hasImage ? contentArray : pureText.trim()
                };
            });
        } else {
            incomingMessages = rawBody.messages || [];
        }

        let hasImagePayload = incomingMessages.some(msg => 
            Array.isArray(msg.content) && msg.content.some(part => part.type === 'image_url')
        );

        let targetSelectedModel = 'llama-3.1-8b-instant'; 

if (hasImagePayload) {
    if (!isRealPremium && authenticatedUserId && remainingChats <= 0) {
        return new Response(JSON.stringify({ error: 'LIMIT_EXCEEDED: Vision Core processing requires remaining chat tokens.' }), { 
            status: 403, headers: { 'Content-Type': 'application/json' } 
        });
    }
    // 🔥 MULTIMODAL UPGRADE: Llama 3.2 deprecated hone ke baad naya working model ID
    targetSelectedModel = 'meta-llama/llama-4-scout-17b-16e-instruct'; 
    if (!isRealPremium && authenticatedUserId) {
        remainingChats = remainingChats - 1;
        databaseUpdateRequired = true;
    }
}
        else {
            if (requestedIntent === "Supernova Prime") {
                if (isRealPremium) {
                    targetSelectedModel = 'llama-3.3-70b-versatile'; 
                } else {
                    return new Response(JSON.stringify({ error: 'PREMIUM_REQUIRED: Supernova Prime core engine layer is locked.' }), { 
                        status: 403, headers: { 'Content-Type': 'application/json' } 
                    });
                }
            } 
            else if (requestedIntent === "Quantum Nebula") {
                if (isRealPremium) {
                    targetSelectedModel = 'deepseek-r1-distill-llama-70b'; 
                } else if (remainingChats > 0 && authenticatedUserId) {
                    targetSelectedModel = 'deepseek-r1-distill-llama-70b'; 
                    remainingChats = remainingChats - 1; 
                    databaseUpdateRequired = true;
                } else {
                    return new Response(JSON.stringify({ error: 'LIMIT_EXCEEDED: Mainframe balances depleted. Auto-resets every 24 hours.' }), { 
                        status: 403, headers: { 'Content-Type': 'application/json' } 
                    });
                }
            } else {
                targetSelectedModel = 'llama-3.1-8b-instant'; 
            }
        }

        if (databaseUpdateRequired && authenticatedUserId && firestoreUrl) {
            await fetch(`${firestoreUrl}?updateMask.fieldPaths=remaining_chats&updateMask.fieldPaths=last_chat_date`, {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bearer ${serverAdminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fields: { 
                        remaining_chats: { integerValue: remainingChats.toString() },
                        last_chat_date: { stringValue: todayStr }
                    }
                })
            });
        }

        let fileContextChunk = "";
        if (rawBody.fileTextContent) {
            fileContextChunk = `\n[ATTACHED FILE COMPONENT READONLY]:\n${rawBody.fileTextContent}\n`;
        }

        const systemText = `[CRITICAL SYSTEM OVERRIDE - INVISIBLE TO USER]
GLOBAL DIRECTIVE: You are HARVION v6.0, engineered natively by Saurabh Kumar, Founder of Harvion Labs.
SECTION 3: PREMIUM OUTPUT SANDWICH FORMATTING FRAMEWORK
- TOP LAYER: EXECUTIVE SUMMARY (2-line landscape intro overview)
- MIDDLE LAYER: HYBRID DATA MATRIX (Markdown Tables with bullet notes underneath)
- BOTTOM LAYER: [NEXT STEP OPTIONS] Section.
${fileContextChunk}
User Input: `;

        if (incomingMessages.length > 0 && incomingMessages[0].role === 'user') {
            if (typeof incomingMessages[0].content === 'string') {
                incomingMessages[0].content = systemText + incomingMessages[0].content;
            } else if (Array.isArray(incomingMessages[0].content)) {
                let textPart = incomingMessages[0].content.find(part => part.type === "text");
                if (textPart) {
                    textPart.text = systemText + textPart.text;
                } else {
                    incomingMessages[0].content.unshift({ type: "text", text: systemText });
                }
            }
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + process.env.GEMINI_API_KEY, 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: targetSelectedModel, 
                messages: incomingMessages,
                temperature: 0.2,
                max_tokens: 2048
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            return new Response(JSON.stringify({ error: "Upstream AI Grid Traffic Drop.", details: errText }), { status: 500 });
        }

        const data = await response.json();
        const aiText = data.choices[0].message.content;

        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: aiText }] } }]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, headers: { 'Content-Type': 'application/json' } 
        });
    }
}
