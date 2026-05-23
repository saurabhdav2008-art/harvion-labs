import { Groq } from 'groq-sdk';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
    api: { bodyParser: false }, // Multipart audio data stream ke liye default parser off
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method drop.' });

    // 🔥 LOOPHOLE FIXED: Vercel serverless link ko force-wait karwane ke liye Promise return kiya
    return new Promise((resolve) => {
        const form = formidable({});
        
        form.parse(req, async (err, fields, files) => {
            if (err) {
                res.status(500).json({ error: 'Buffer allocation failure.' });
                return resolve(); // Promise resolve hona zaroori hai taaki serverless chain end ho
            }

            try {
                // 🔥 COMPATIBILITY CHECK: Formidable ke alag-alag versions ke hisab se safety layer
                const audioFile = Array.isArray(files.file) ? files.file[0] : files.file;
                
                if (!audioFile) {
                    res.status(400).json({ error: 'No audio payload found.' });
                    return resolve();
                }

                // File path check for standard versions
                const filePath = audioFile.filepath || audioFile.path;

                // 🎙️ GROQ WHISPER ENGINE INTERFACE CALL
                const transcription = await groq.audio.transcriptions.create({
                    file: fs.createReadStream(filePath),
                    model: 'whisper-large-v3', // Deep voice processing model
                    response_format: 'json',
                });

                res.status(200).json({ text: transcription.text });
                resolve();
            } catch (error) {
                console.error("Transcription error array:", error);
                res.status(500).json({ error: error.message });
                resolve();
            }
        });
    });
}
