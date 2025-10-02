import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';

// --- Constants ---
const OLLAMA_ENDPOINT = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'llama3.1';
const TTS_ENDPOINT = 'http://localhost:5000';

const ACTION_CODES = {
    REPEAT_QUESTION: 1,
    CLARIFY_QUESTION: 2,
    NEXT_QUESTION: 3,
    NEXT_TOPIC: 4,
    END_INTERVIEW: 5
};
const getActionCodeName = (code) => Object.keys(ACTION_CODES).find(key => ACTION_CODES[key] === code) || `Unknown (${code})`;

const MAX_ATTEMPTS_PLANNED = 3;
const MAX_FOLLOW_UP_STREAK = 3;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognitionAvailable = !!SpeechRecognition;

// --- DotAudioVisualizer Component ---
const DotAudioVisualizer = ({ mode, audioSource }) => {
    const [audioContext, setAudioContext] = useState(null);
    const [analyser, setAnalyser] = useState(null);
    const mediaSourceNodeRef = useRef(null);
    const canvasRef = useRef(null);
    const animationRef = useRef(null);

    const DEFAULT_GAP = 5;
    const DEFAULT_WIDTH = 1.48;
    const DEFAULT_HEIGHT = 1;
    const DEFAULT_ROUNDNESS = 0.5;
    const BALL_ROUNDNESS_FACTOR = 0.5;

    const BARS = [
        { baseWidth: 10, baseHeight: 30 }, { baseWidth: 10, baseHeight: 30 },
        { baseWidth: 14, baseHeight: 40 }, { baseWidth: 16, baseHeight: 50 },
        { baseWidth: 14, baseHeight: 40 }, { baseWidth: 10, baseHeight: 30 },
        { baseWidth: 10, baseHeight: 30 },
    ];

    const currentMorph = useRef(1);
    const targetMorph = useRef(1);
    const currentReactivityFactor = useRef(0);
    const targetReactivityFactor = useRef(0);
    const currentBounceIntensity = useRef(0);
    const targetBounceIntensity = useRef(0);

    useEffect(() => {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx({ sampleRate: 48000 });
        const analyserNode = ctx.createAnalyser();
        analyserNode.fftSize = 1024;
        analyserNode.smoothingTimeConstant = 0.7;
        setAudioContext(ctx);
        setAnalyser(analyserNode);

        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
            if (mediaSourceNodeRef.current) {
                try { mediaSourceNodeRef.current.disconnect(); } catch(e){}
            }
            if (ctx && ctx.state !== 'closed') {
                ctx.close().catch(e => console.error("Error closing AudioContext:", e));
            }
        };
    }, []);

    useEffect(() => {
        if (!audioContext || !analyser) return;

        if (mediaSourceNodeRef.current) {
            try { mediaSourceNodeRef.current.disconnect(); } catch (e) { console.warn("Error disconnecting previous audio source:", e); }
            mediaSourceNodeRef.current = null;
        }

        if (mode === "play" && audioSource) {
            let sourceNode;
            try {
                if (audioSource instanceof HTMLAudioElement) {
                    if (audioContext.state === 'suspended') { audioContext.resume(); }
                    sourceNode = audioContext.createMediaElementSource(audioSource);
                    sourceNode.connect(analyser);
                    sourceNode.connect(audioContext.destination);
                    console.log("Visualizer: Connected MediaElementSource (TTS) to analyser and destination");
                } else if (audioSource instanceof MediaStream) {
                    if (audioContext.state === 'suspended') { audioContext.resume(); }
                    sourceNode = audioContext.createMediaStreamSource(audioSource);
                    sourceNode.connect(analyser);
                    console.log("Visualizer: Connected MediaStreamSource (Mic) to analyser ONLY");
                } else {
                    console.warn("Visualizer: Invalid audioSource type provided:", audioSource);
                    return;
                }
                mediaSourceNodeRef.current = sourceNode;
            } catch (error) {
                console.error("Visualizer: Error creating or connecting audio source:", error);
                if (sourceNode) { try { sourceNode.disconnect(); } catch(e) {} }
                mediaSourceNodeRef.current = null;
            }
        } else {
            if (audioContext.state === 'running') {
                audioContext.suspend().catch(e => console.warn("Could not suspend AudioContext:", e));
            }
        }
    }, [mode, audioSource, audioContext, analyser]);

    useEffect(() => {
        if (mode === "play") {
            targetMorph.current = 0;
            targetReactivityFactor.current = 1;
            targetBounceIntensity.current = 0;
            if (audioContext && audioContext.state === "suspended") {
                audioContext.resume().catch(e => console.warn("Could not resume AudioContext:", e));
            }
        } else if (mode === "static") {
            targetMorph.current = 1;
            targetReactivityFactor.current = 0;
            targetBounceIntensity.current = 0;
            if (audioContext && audioContext.state === "running") {
                audioContext.suspend().catch(e => console.warn("Could not suspend AudioContext:", e));
            }
        } else if (mode === "think") {
            targetMorph.current = 1;
            targetReactivityFactor.current = 0;
            targetBounceIntensity.current = 1;
            if (audioContext && audioContext.state === "running") {
                audioContext.suspend().catch(e => console.warn("Could not suspend AudioContext:", e));
            }
        }
    }, [mode, audioContext]);

    useEffect(() => {
        if (!analyser || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const BOUNCE_DURATION_MS = 2100;
        const BOUNCE_DELAY_MS = 150;
        const BOUNCE_MAX_HEIGHT_PX = 90;
        const BOUNCE_MIN_SCALE = 0.3;

        const calculateBounceTransform = (timeMs, index) => {
            const delay = index * BOUNCE_DELAY_MS;
            const effectiveTime = ((timeMs - delay) % BOUNCE_DURATION_MS + BOUNCE_DURATION_MS) % BOUNCE_DURATION_MS;
            const normalizedTime = effectiveTime / BOUNCE_DURATION_MS;
            const bounceProgress = Math.sin(normalizedTime * Math.PI);
            const offsetY = -bounceProgress * BOUNCE_MAX_HEIGHT_PX;
            const scaleFactor = 1 - (1 - BOUNCE_MIN_SCALE) * bounceProgress;
            return { offsetY, scaleFactor };
        };

        const MORPH_SPEED = 0.08;
        const REACTIVITY_SPEED = 0.1;
        const BOUNCE_SPEED = 0.1;
        const SNAP_THRESHOLD = 0.001;

        const draw = (currentTime) => {
            animationRef.current = requestAnimationFrame(draw);
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;
                ctx.scale(dpr, dpr);
            }
            const canvasWidth = canvas.clientWidth;
            const canvasHeight = canvas.clientHeight;
            const centerY = canvasHeight / 2;

            ctx.clearRect(0, 0, canvasWidth, canvasHeight);

            if (currentReactivityFactor.current > SNAP_THRESHOLD || targetReactivityFactor.current > 0) {
                analyser.getByteFrequencyData(dataArray);
            } else {
                dataArray.fill(0);
            }

            currentMorph.current += (targetMorph.current - currentMorph.current) * MORPH_SPEED;
            currentReactivityFactor.current += (targetReactivityFactor.current - currentReactivityFactor.current) * REACTIVITY_SPEED;
            currentBounceIntensity.current += (targetBounceIntensity.current - currentBounceIntensity.current) * BOUNCE_SPEED;

            if (Math.abs(currentMorph.current - targetMorph.current) < SNAP_THRESHOLD) currentMorph.current = targetMorph.current;
            if (Math.abs(currentReactivityFactor.current - targetReactivityFactor.current) < SNAP_THRESHOLD) currentReactivityFactor.current = targetReactivityFactor.current;
            if (Math.abs(currentBounceIntensity.current - targetBounceIntensity.current) < SNAP_THRESHOLD) currentBounceIntensity.current = targetBounceIntensity.current;

            const scaledWidths = BARS.map(bar => bar.baseWidth * DEFAULT_WIDTH);
            const centralGap = DEFAULT_GAP * 1.5;
            const edgeGap = DEFAULT_GAP;
            let totalWidth = 0;
            scaledWidths.forEach((w, i) => {
                totalWidth += w;
                if (i < BARS.length - 1) {
                    totalWidth += (i === 2 || i === 3) ? centralGap : edgeGap;
                }
            });

            const centerX = canvasWidth / 2;
            let startX = centerX - totalWidth / 2;

            ctx.fillStyle = 'rgb(255, 255, 255)';
            scaledWidths.forEach((baseScaledWidth, i) => {
                const barConfig = BARS[i];
                const barCenterX = startX + baseScaledWidth / 2;

                const freqBinIndex = Math.min(
                    Math.floor(bufferLength * (0.05 + i * 0.08)),
                    bufferLength - 1
                );
                const freqValue = dataArray[freqBinIndex] / 255.0;

                const effectiveFreqInfluence = freqValue * currentReactivityFactor.current;
                const reactiveWidthIncrease = baseScaledWidth * 0.2 * effectiveFreqInfluence;
                const computedWidth = baseScaledWidth + reactiveWidthIncrease;
                const computedHeight = (barConfig.baseHeight * DEFAULT_HEIGHT) + (barConfig.baseHeight * DEFAULT_HEIGHT * 1.5 * effectiveFreqInfluence);

                const morphedHeight = computedHeight * (1 - currentMorph.current) + computedWidth * currentMorph.current;
                const morphedRadiusFactor = (1 - currentMorph.current) * DEFAULT_ROUNDNESS + currentMorph.current * BALL_ROUNDNESS_FACTOR;
                const morphedRadius = computedWidth * morphedRadiusFactor;

                let baseOffsetY = 0;
                let baseScaleFactor = 1;
                if (currentBounceIntensity.current > SNAP_THRESHOLD) {
                    const bounce = calculateBounceTransform(currentTime, i);
                    baseOffsetY = bounce.offsetY * currentBounceIntensity.current;
                    baseScaleFactor = 1 + (bounce.scaleFactor - 1) * currentBounceIntensity.current;
                }

                const finalWidth = computedWidth * baseScaleFactor;
                const finalHeight = morphedHeight * baseScaleFactor;
                const finalRadius = Math.min(morphedRadius * baseScaleFactor, finalWidth / 2, finalHeight / 2);
                const finalYCenter = centerY + baseOffsetY;
                const xLeft = barCenterX - finalWidth / 2;
                const yTop = finalYCenter - finalHeight / 2;

                ctx.beginPath();
                ctx.moveTo(xLeft + finalRadius, yTop);
                ctx.lineTo(xLeft + finalWidth - finalRadius, yTop);
                ctx.arcTo(xLeft + finalWidth, yTop, xLeft + finalWidth, yTop + finalRadius, finalRadius);
                ctx.lineTo(xLeft + finalWidth, yTop + finalHeight - finalRadius);
                ctx.arcTo(xLeft + finalWidth, yTop + finalHeight, xLeft + finalWidth - finalRadius, yTop + finalHeight, finalRadius);
                ctx.lineTo(xLeft + finalRadius, yTop + finalHeight);
                ctx.arcTo(xLeft, yTop + finalHeight, xLeft, yTop + finalHeight - finalRadius, finalRadius);
                ctx.lineTo(xLeft, yTop + finalRadius);
                ctx.arcTo(xLeft, yTop, xLeft + finalRadius, yTop, finalRadius);
                ctx.closePath();
                ctx.fill();

                if (i < BARS.length - 1) {
                    const currentGap = (i === 2 || i === 3) ? centralGap : edgeGap;
                    startX += baseScaledWidth + currentGap;
                }
            });
        };

        animationRef.current = requestAnimationFrame(draw);
        return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
    }, [analyser]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div style={{ position: 'absolute', inset: 0, zIndex: 0, opacity: 0.3 }}>
                <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                    <filter id="noiseFilter">
                        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" stitchTiles="stitch" />
                        <feDisplacementMap in="SourceGraphic" scale="20" />
                    </filter>
                    <rect width="100%" height="100%" filter="url(#noiseFilter)" fill="none" stroke="#333" strokeWidth="0.5" />
                </svg>
            </div>
            <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%', display: 'block', position: 'relative', zIndex: 10 }}
            />
        </div>
    );
};

// --- Helper Functions ---
const parseLlmJson = (llmContent, expectedKeys = []) => {
    if (!llmContent || typeof llmContent !== 'string') {
        console.error("LLM response is empty or not a string:", llmContent);
        throw new Error("LLM response is missing or invalid.");
    }
    const trimmedContent = llmContent.trim();
    let jsonString;
    const jsonMatch = trimmedContent.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
        jsonString = jsonMatch[1].trim();
    } else {
        jsonString = trimmedContent;
        const firstBrace = jsonString.indexOf('{');
        const lastBrace = jsonString.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonString = jsonString.substring(firstBrace, lastBrace + 1);
        } else {
            console.warn("Could not reliably extract JSON markers or delimiters from response:", trimmedContent);
            if (expectedKeys.includes("type") && expectedKeys.includes("text")) {
                console.warn("Assuming plain text response for potential closing statement.");
                return { type: "planned", text: trimmedContent };
            } else {
                throw new Error("Could not find JSON object delimiters {} in the response.");
            }
        }
    }
    try {
        const parsedJson = JSON.parse(jsonString);
        if (expectedKeys.length > 0) {
            const missingKeys = expectedKeys.filter(key => !(key in parsedJson));
            if (missingKeys.length > 0) {
                console.warn(`LLM JSON response might be missing keys: ${missingKeys.join(", ")}. Expected: ${expectedKeys.join(", ")}`);
                if (missingKeys.length === expectedKeys.length && !(expectedKeys.includes("type") && expectedKeys.includes("text") && typeof parsedJson === 'string')) {
                    throw new Error(`LLM JSON response is missing critical keys: ${missingKeys.join(", ")}`);
                }
            }
        }
        if (expectedKeys.includes("type") && expectedKeys.includes("text")) {
            if (typeof parsedJson.type !== 'string' || typeof parsedJson.text !== 'string') {
                if (typeof parsedJson !== 'object') {
                    console.warn("Interviewer LLM response seems to be plain text, assuming closing statement.");
                    return { type: "planned", text: String(parsedJson) };
                } else if (!parsedJson.type && !parsedJson.text) {
                    console.warn("Interviewer LLM returned empty JSON object. Treating as invalid.");
                    throw new Error("Interviewer LLM returned an empty JSON object.");
                } else {
                    console.warn("Interviewer LLM JSON response structure seems incorrect for type/text.", parsedJson);
                    if (parsedJson.text && typeof parsedJson.text === 'string') {
                        return { type: "planned", text: parsedJson.text };
                    }
                    throw new Error("Interviewer LLM JSON response has incorrect structure for type/text fields.");
                }
            }
        }
        return parsedJson;
    } catch (error) {
        console.error("Failed to parse LLM JSON response:", error);
        console.error("Original String attempting to parse:", jsonString);
        if (expectedKeys.includes("type") && expectedKeys.includes("text") && typeof jsonString === 'string' && jsonString.length > 5) {
            console.warn("Parsing failed, returning raw text as potential closing statement.");
            return { type: "planned", text: jsonString };
        }
        throw new Error(`Failed to parse JSON from LLM: ${error.message}`);
    }
};

const callOllamaApi = async (prompt, model = OLLAMA_MODEL, endpoint = OLLAMA_ENDPOINT) => {
    console.log(`Calling Ollama (${model})`);
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                stream: false,
                format: 'json'
            }),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Ollama API Error Response:", errorBody);
            throw new Error(`Ollama API request failed: ${response.status} ${response.statusText}. ${errorBody}`);
        }
        const data = await response.json();
        if (!data || typeof data.response !== 'string') {
            console.error("Invalid response structure from Ollama (expected data.response as string):", data);
            throw new Error("Invalid or unexpected response structure from Ollama API.");
        }
        console.log("Ollama Raw Response Content received.");
        return data.response;
    } catch (error) {
        console.error("Error calling Ollama API:", error);
        throw new Error(`Network or API error calling Ollama: ${error.message}`);
    }
};

const callPlannerLlm = async (jobDescription) => {
    const prompt = `Analyze Job Description: """ ${jobDescription} """ Instructions: 1. Identify 2 critical skill areas relevant to the job. 2. For each topic, devise 3 interview questions progressing in difficulty or depth. 3. Output ONLY the following JSON structure: \`\`\`json { "topics": [ { "name": "Topic1 Name", "questions": ["Question 1.1", "Question 1.2", "Question 1.3"] }, { "name": "Topic2 Name", "questions": ["Question 2.1", "Question 2.2", "Question 2.3"] } ] } \`\`\` Ensure the output contains nothing but this JSON object.`;
    const llmResponse = await callOllamaApi(prompt);
    return parseLlmJson(llmResponse, ["topics"]);
};

const callInterviewerLlm = async (
    topicName, questionText, actionCode, previousInterviewerMessage,
    candidateAnswer, discussionPoint
) => {
    let promptContext = `You are an AI Interviewer. Your persona is professional, engaging, and conversational. Focus on the current interview topic.\nCurrent topic: "${topicName}".\n`;
    if (previousInterviewerMessage) promptContext += `You previously said: "${previousInterviewerMessage}"\n`;
    if (candidateAnswer) promptContext += `Candidate responded: "${candidateAnswer}"\n`;
    if (discussionPoint) promptContext += `A Monitor suggested focusing on: "${discussionPoint}"\n`;

    let coreInstruction = "";
    switch (actionCode) {
        case ACTION_CODES.REPEAT_QUESTION:
            coreInstruction = `The candidate's previous answer was insufficient or missed the point. Rephrase the following question naturally and ask it again: "${questionText}"`;
            break;
        case ACTION_CODES.CLARIFY_QUESTION:
            coreInstruction = `The candidate's answer was partially relevant but lacked detail or clarity. Ask for clarification or elaboration on the original question: "${questionText}"`;
            break;
        case ACTION_CODES.NEXT_QUESTION:
            coreInstruction = `Ask the next planned question naturally and conversationally: "${questionText}"`;
            if (!previousInterviewerMessage) {
                coreInstruction = `Start the interview by introducing the first topic "${topicName}" and asking the first question: "${questionText}"`;
            }
            break;
        case ACTION_CODES.NEXT_TOPIC:
            coreInstruction = `Smoothly transition to the next topic "${topicName}" and ask its first question: "${questionText}"`;
            break;
        case ACTION_CODES.END_INTERVIEW:
            coreInstruction = `**CRITICAL: Conclude the interview NOW.** Your response MUST be ONLY a polite closing statement (e.g., 'Thank you for your time. That concludes our interview.' or similar). Do NOT ask any more questions. Do NOT add any other text.`;
            break;
        default:
            coreInstruction = `Ask the planned question neutrally: "${questionText}"`;
            break;
    }

    const prompt = `${promptContext}
Instructions:
1. Briefly acknowledge the candidate's previous answer if appropriate (unless ending or repeating).
2. **If Action Code is ${ACTION_CODES.END_INTERVIEW} (END_INTERVIEW):** Follow the core instruction EXACTLY. Output ONLY the closing statement in the 'text' field of the JSON, and set 'type' to "planned".
3. **If Action Code is NOT ${ACTION_CODES.END_INTERVIEW}:**
    a. Consider the candidate's answer and the Monitor's suggestion (${discussionPoint ? `"${discussionPoint}"` : 'none'}).
    b. Decide whether a brief, relevant, natural-sounding follow-up question is appropriate *instead* of the planned action. Ask AT MOST ONE follow-up.
    c. If asking a follow-up: Set 'type' to "follow-up" and 'text' to your follow-up question.
    d. If NOT asking a follow-up: Proceed with the core instruction: ${coreInstruction}. Set 'type' to "planned" and 'text' to the resulting question/statement.
4. Ensure your response ('text' field) is a single, natural-sounding sentence or question (or the closing statement if ending).
5. Output ONLY JSON in the specified format: \`\`\`json { "type": "<'planned' or 'follow-up'>", "text": "<Your single sentence/question or closing statement>" } \`\`\`
Ensure the entire output contains absolutely nothing but the JSON object.`;

    const llmResponseString = await callOllamaApi(prompt);
    const parsedResponse = parseLlmJson(llmResponseString, ["type", "text"]);

    if (actionCode === ACTION_CODES.END_INTERVIEW) {
        parsedResponse.type = 'planned';
    } else if (parsedResponse.type !== 'planned' && parsedResponse.type !== 'follow-up') {
        console.warn(`Interviewer LLM returned unexpected type: "${parsedResponse.type}". Defaulting to 'planned'. Original text: "${parsedResponse.text}"`);
        parsedResponse.type = 'planned';
    }
    if (typeof parsedResponse.text !== 'string') {
        console.warn(`Interviewer LLM response text is not a string:`, parsedResponse.text, `Falling back to empty string.`);
        parsedResponse.text = "";
    }

    return parsedResponse;
};

const callMonitorLlm = async (topicIndex, questionIndex, questionText, answer, history, isFollowUp = false) => {
    const historyString = history.map((h, i) => `Attempt ${i+1}: Interviewer: ${h.question}\nCandidate: ${h.answer}`).join('\n\n');
    const followUpContext = isFollowUp ? "This was an answer to a spontaneous follow-up question." : "This was an answer to a planned question.";

    const prompt = `You are an AI Interview Monitor providing feedback on a candidate's answer.
${followUpContext}
Context:
- Current Topic Index: ${topicIndex}
- Current Question Index (within topic): ${questionIndex}
- Question Asked: "${questionText}" ${isFollowUp ? "(This was a follow-up question)" : ""}
- Candidate's Answer: "${answer}"
- History for this question (if any):\n${historyString || "This was the first attempt for this question."}\n

Task: Evaluate the candidate's answer based ONLY on the provided information.
1. Assess the answer on four metrics (scale 0.0 to 1.0):
    - accuracy: Correctness of factual information.
    - relevance: How well the answer addresses the specific question asked.
    - clarity: How clear and understandable the answer is.
    - completeness: How thoroughly the answer addresses all parts of the question.
2. Choose an appropriate Action Code based on your evaluation:
    - ${ACTION_CODES.REPEAT_QUESTION} (REPEAT_QUESTION): Answer is completely irrelevant, nonsensical, or missing. Ask the *exact same* question again, perhaps rephrased by the Interviewer LLM.
    - ${ACTION_CODES.CLARIFY_QUESTION}: Answer is partially correct/relevant but needs more detail, clarification, or examples. Ask for elaboration on the *same* question.
    - ${ACTION_CODES.NEXT_QUESTION}: Answer is satisfactory. Move to the next question within the current topic.
    - ${ACTION_CODES.NEXT_TOPIC}: Answer is satisfactory AND it's the last question of the topic, OR the answer demonstrates clear mastery justifying moving on. Move to the next topic.
    - ${ACTION_CODES.END_INTERVIEW}: **Use EXTREMELY sparingly.** ONLY use if the candidate is completely unresponsive after multiple attempts, provides nonsensical answers across multiple questions unrelated to the topic, or explicitly asks to end the interview. Do NOT use just because one answer is weak or slightly off-topic.
3. Provide a concise 'reason' (1-2 sentences) explaining your action code choice.
4. Optionally, provide a brief 'discussion_point' (max 10 words, string or null) suggesting a specific aspect the Interviewer LLM could focus on (e.g., "focus on technical details", "ask for specific example"). Set to null if no specific guidance is needed.

Output Format: Respond ONLY with a valid JSON object adhering to this structure:
\`\`\`json
{
  "topicIndex": ${topicIndex},
  "questionIndex": ${questionIndex},
  "metrics": {
    "accuracy": <float_0.0_to_1.0>,
    "relevance": <float_0.0_to_1.0>,
    "clarity": <float_0.0_to_1.0>,
    "completeness": <float_0.0_to_1.0>
  },
  "actionCode": <integer_1_to_5>,
  "reason": "<string_explanation>",
  "discussion_point": "<string_max_10_words_or_null>"
}
\`\`\`
Ensure the entire output contains absolutely nothing but this JSON object.`;

    const llmResponse = await callOllamaApi(prompt);
    return parseLlmJson(llmResponse, ["topicIndex", "questionIndex", "metrics", "actionCode", "reason", "discussion_point"]);
};

// --- Main Component ---
function InterviewPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const jobDetails = location.state?.jobDetails;

    const [interviewPlan, setInterviewPlan] = useState(null);
    const [currentTopicIndex, setCurrentTopicIndex] = useState(0);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [currentQuestionAttempts, setCurrentQuestionAttempts] = useState(0);
    const [conversation, setConversation] = useState([]);
    const [candidateInput, setCandidateInput] = useState('');
    const [interviewLog, setInterviewLog] = useState([]);
    const [interviewState, setInterviewState] = useState('SETUP');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [isFollowUpActive, setIsFollowUpActive] = useState(false);
    const [currentFollowUpQuestionText, setCurrentFollowUpQuestionText] = useState(null);
    const [pausedState, setPausedState] = useState(null);
    const [currentFollowUpStreak, setCurrentFollowUpStreak] = useState(0);

    const [isRecording, setIsRecording] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [finalTranscript, setFinalTranscript] = useState('');

    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [codeContent, setCodeContent] = useState('');

    const [voices, setVoices] = useState([]);
    const [selectedVoice, setSelectedVoice] = useState('');
    const [speed, setSpeed] = useState(1.0);
    const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
    const [isTTSPlaying, setIsTTSPlaying] = useState(false);
    const [currentTTSAudio, setCurrentTTSAudio] = useState(null);

    const [micStream, setMicStream] = useState(null);
    const [currentMode, setCurrentMode] = useState('convo');

    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const [report, setReport] = useState('');
    const [isReportLoading, setIsReportLoading] = useState(false);

    const recognitionInstance = useRef(null);
    const currentQuestionHistory = useRef([]);
    const lastInterviewerMessage = useRef(null);
    const lastCandidateAnswer = useRef(null);
    const lastDiscussionPoint = useRef(null);
    const chatContainerRef = useRef(null);
    const audioQueueRef = useRef([]);
    const isProcessingAudioRef = useRef(false);

    useEffect(() => {
        setTimeout(() => {
            chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
        }, 0);
    }, [conversation]);

    useEffect(() => {
        if (interviewState === 'PLANNING_COMPLETE' && interviewPlan) {
            console.log("Planning complete. Starting interview.");
            setInterviewState('IN_PROGRESS');
            setCurrentTopicIndex(0);
            setCurrentQuestionIndex(0);
            setCurrentQuestionAttempts(0);
            setIsFollowUpActive(false);
            setCurrentFollowUpQuestionText(null);
            setPausedState(null);
            setCurrentFollowUpStreak(0);
            currentQuestionHistory.current = [];
            lastCandidateAnswer.current = null;
            lastDiscussionPoint.current = null;
            askQuestion(0, 0, ACTION_CODES.NEXT_QUESTION);
        }
    }, [interviewState, interviewPlan]);

    useEffect(() => {
        fetch(`${TTS_ENDPOINT}/voices`)
            .then(res => {
                if (!res.ok) { throw new Error(`HTTP error! status: ${res.status}`); }
                return res.json();
            })
            .then(data => {
                if (data?.voices && Array.isArray(data.voices) && data.voices.length > 0) {
                    setVoices(data.voices);
                    const defaultVoice = data.voices.find(v => v.includes("Jenny")) || data.voices[0];
                    setSelectedVoice(defaultVoice);
                } else {
                    console.warn("No voices received from TTS backend or invalid format:", data);
                    setVoices([]);
                }
            })
            .catch(error => {
                console.error('Error fetching TTS voices:', error);
                setErrorMessage(`Could not fetch TTS voices: ${error.message}. Is the TTS server running at ${TTS_ENDPOINT}?`);
                setVoices([]);
            });
    }, []);

    useEffect(() => {
        return () => {
            if (recognitionInstance.current) {
                try { recognitionInstance.current.stop(); } catch(e){}
                recognitionInstance.current = null;
            }
            if (micStream) {
                micStream.getTracks().forEach(track => track.stop());
            }
            audioQueueRef.current.forEach(({ url }) => URL.revokeObjectURL(url));
            audioQueueRef.current = [];
            if (currentTTSAudio) {
                currentTTSAudio.pause();
            }
            isProcessingAudioRef.current = false;
            setIsTTSPlaying(false);
            console.log("Cleaned up STT, Mic, TTS on unmount.");
        };
    }, []);

    useEffect(() => {
        if (jobDetails && jobDetails.description) {
            handleStartInterview(jobDetails.description);
        } else {
            setErrorMessage('Job details are missing. Please start from the landing page.');
        }
    }, [jobDetails]);

    const generateTTS = useCallback(async (text) => {
        if (!text || text.trim() === '' || !selectedVoice) return null;
        console.log(`Generating TTS for: "${text.substring(0, 50)}..." Voice: ${selectedVoice}, Speed: ${speed}`);
        try {
            const response = await fetch(`${TTS_ENDPOINT}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text.trim(), voice: selectedVoice, speed }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`TTS generation failed: ${response.status} ${response.statusText}`, errorText);
                throw new Error(`TTS generation failed: ${response.status} ${response.statusText}. ${errorText}`);
            }
            const blob = await response.blob();
            if (!blob.type.startsWith('audio/')) {
                console.warn("Received unexpected blob type from TTS:", blob.type);
            }
            return URL.createObjectURL(blob);
        } catch (error) {
            console.error('TTS Generation Error:', error);
            setErrorMessage(`TTS Error: ${error.message}`);
            return null;
        }
    }, [selectedVoice, speed]);

    const playAudioQueue = useCallback(async () => {
        if (isProcessingAudioRef.current || audioQueueRef.current.length === 0 || !isVoiceEnabled) {
            if (audioQueueRef.current.length === 0) setIsTTSPlaying(false);
            return;
        }

        isProcessingAudioRef.current = true;
        setIsTTSPlaying(true);
        console.log("Starting audio playback queue...");

        const { url, text } = audioQueueRef.current[0];
        console.log(`Playing audio for: "${text.substring(0, 50)}..."`);

        try {
            await new Promise((resolve, reject) => {
                const audio = new Audio(url);
                setCurrentTTSAudio(audio);

                audio.onended = () => {
                    console.log(`Audio finished for: "${text.substring(0, 50)}..."`);
                    URL.revokeObjectURL(url);
                    setCurrentTTSAudio(null);
                    resolve();
                };
                audio.onerror = (e) => {
                    console.error('Audio playback error:', e);
                    URL.revokeObjectURL(url);
                    setCurrentTTSAudio(null);
                    reject(new Error('Audio playback failed'));
                };
                audio.play().catch(err => {
                    console.error('Audio play() error:', err);
                    URL.revokeObjectURL(url);
                    setCurrentTTSAudio(null);
                    resolve();
                });
            });
        } catch (error) {
            console.error('Playback Promise Error:', error.message);
        } finally {
            audioQueueRef.current.shift();
            isProcessingAudioRef.current = false;
            if (audioQueueRef.current.length > 0) {
                setTimeout(playAudioQueue, 50);
            } else {
                setIsTTSPlaying(false);
                console.log("Audio playback queue finished.");
            }
        }
    }, [isVoiceEnabled]);

    const askQuestion = useCallback(async (topicIdx, questionIdx, actionCode, forceEnd = false) => {
        console.log(`askQuestion called with: T${topicIdx}, Q${questionIdx}, Action: ${getActionCodeName(actionCode)}, ForceEnd: ${forceEnd}, Current Streak: ${currentFollowUpStreak}, IsFollowUpActive: ${isFollowUpActive}`);
        setIsLoading(true); setErrorMessage('');

        let plannedTopicName = "N/A";
        let plannedQuestionText = "N/A";
        let effectiveActionCode = actionCode;
        let endInterview = forceEnd;
        let nextStateTopicIndex = topicIdx;
        let nextStateQuestionIndex = questionIdx;

        if (endInterview) {
            effectiveActionCode = ACTION_CODES.END_INTERVIEW;
        } else if (!interviewPlan || !interviewPlan.topics[topicIdx]) {
            console.warn(`Invalid topic index ${topicIdx} or no plan. Ending interview.`);
            effectiveActionCode = ACTION_CODES.END_INTERVIEW;
            endInterview = true;
        } else {
            plannedTopicName = interviewPlan.topics[topicIdx].name;
            if (interviewPlan.topics[topicIdx].questions && questionIdx < interviewPlan.topics[topicIdx].questions.length) {
                plannedQuestionText = interviewPlan.topics[topicIdx].questions[questionIdx];
                if (effectiveActionCode === ACTION_CODES.NEXT_TOPIC) {
                    console.warn(`Corrected action from NEXT_TOPIC to NEXT_QUESTION as current topic T${topicIdx} still has questions.`);
                    effectiveActionCode = ACTION_CODES.NEXT_QUESTION;
                }
            } else {
                console.log(`End of questions reached for Topic ${topicIdx}. Checking next topic.`);
                const nextTopicIdx = topicIdx + 1;
                if (interviewPlan.topics[nextTopicIdx]) {
                    effectiveActionCode = ACTION_CODES.NEXT_TOPIC;
                    plannedTopicName = interviewPlan.topics[nextTopicIdx].name;
                    plannedQuestionText = interviewPlan.topics[nextTopicIdx].questions[0];
                    nextStateTopicIndex = nextTopicIdx;
                    nextStateQuestionIndex = 0;
                    console.log(`Transitioning to next topic: T${nextStateTopicIndex}`);
                } else {
                    console.log("No more topics remaining. Ending interview.");
                    effectiveActionCode = ACTION_CODES.END_INTERVIEW;
                    endInterview = true;
                }
            }
        }

        if (effectiveActionCode === ACTION_CODES.END_INTERVIEW) {
            plannedTopicName = "Interview Conclusion";
            plannedQuestionText = "Provide closing statement.";
            console.log("Preparing to call Interviewer LLM for final closing statement.");
        }

        try {
            const interviewerOutput = await callInterviewerLlm(
                plannedTopicName, plannedQuestionText, effectiveActionCode,
                lastInterviewerMessage.current, lastCandidateAnswer.current, lastDiscussionPoint.current
            );
            const interviewerResponseType = interviewerOutput.type;
            const interviewerResponseText = interviewerOutput.text;

            console.log(`Interviewer LLM Output - Type: "${interviewerResponseType}", Text: "${interviewerResponseText.substring(0,100)}..."`);

            if (interviewerResponseText && interviewerResponseText.trim() !== '') {
                const newInterviewerMsg = { role: 'interviewer', content: interviewerResponseText };
                setConversation(prev => [...prev, newInterviewerMsg]);

                if (isVoiceEnabled) {
                    const audioUrl = await generateTTS(interviewerResponseText);
                    if (audioUrl) {
                        audioQueueRef.current.push({ url: audioUrl, text: interviewerResponseText });
                        if (!isProcessingAudioRef.current) { setTimeout(playAudioQueue, 0); }
                    }
                }
                lastInterviewerMessage.current = interviewerResponseText;
            } else {
                console.warn("Interviewer LLM returned empty text.");
                lastInterviewerMessage.current = null;
            }

            lastCandidateAnswer.current = null;
            lastDiscussionPoint.current = null;

            if (interviewerResponseType === 'follow-up' && effectiveActionCode !== ACTION_CODES.END_INTERVIEW) {
                if (currentFollowUpStreak < MAX_FOLLOW_UP_STREAK) {
                    console.log(`Follow-up initiated by LLM (Streak ${currentFollowUpStreak + 1}/${MAX_FOLLOW_UP_STREAK}). Pausing planned flow.`);
                    setCurrentFollowUpStreak(prev => prev + 1);
                    setPausedState({
                        topicIndex: topicIdx, questionIndex: questionIdx,
                        attempts: currentQuestionAttempts, resumingActionCode: effectiveActionCode
                    });
                    setIsFollowUpActive(true);
                    setCurrentFollowUpQuestionText(interviewerResponseText);
                    currentQuestionHistory.current = [];
                } else {
                    console.warn(`Follow-up limit (${MAX_FOLLOW_UP_STREAK}) reached. Ignoring LLM follow-up and forcing next planned action.`);
                    setConversation(prev => [...prev, { role: 'system', content: `(Max follow-up limit reached. Returning to planned question.)` }]);
                    setIsFollowUpActive(false); setCurrentFollowUpQuestionText(null); setPausedState(null); setCurrentFollowUpStreak(0);

                    let forcedNextTopicIndex = topicIdx;
                    let forcedNextQuestionIndex = questionIdx + 1;
                    let forcedNextAction = ACTION_CODES.NEXT_QUESTION;

                    if (!interviewPlan?.topics[forcedNextTopicIndex]?.questions[forcedNextQuestionIndex]) {
                        forcedNextTopicIndex += 1; forcedNextQuestionIndex = 0; forcedNextAction = ACTION_CODES.NEXT_TOPIC;
                        if (!interviewPlan?.topics[forcedNextTopicIndex]) {
                            console.log("End of plan reached while enforcing streak limit.");
                            setInterviewState('ENDED');
                            try {
                                const finalStatement = await callInterviewerLlm("End", "End", ACTION_CODES.END_INTERVIEW, lastInterviewerMessage.current, null, null);
                                if(finalStatement.text) {
                                    setConversation(prev => [...prev, { role: 'interviewer', content: finalStatement.text }]);
                                    if (isVoiceEnabled) { const url = await generateTTS(finalStatement.text); if(url) { audioQueueRef.current.push({url, text: finalStatement.text}); if(!isProcessingAudioRef.current) setTimeout(playAudioQueue,0); } }
                                } else { throw new Error("Empty closing statement"); }
                            } catch (finalError) { console.error("Error getting final closing statement:", finalError); const fb="Thank you."; setConversation(prev => [...prev, { role: 'interviewer', content: fb }]); if (isVoiceEnabled) {const url = await generateTTS(fb); if(url){ audioQueueRef.current.push({url, text: fb}); if(!isProcessingAudioRef.current) setTimeout(playAudioQueue,0);}}}
                            setIsLoading(false); return;
                        }
                    }
                    setCurrentTopicIndex(forcedNextTopicIndex);
                    setCurrentQuestionIndex(forcedNextQuestionIndex);
                    askQuestion(forcedNextTopicIndex, forcedNextQuestionIndex, forcedNextAction);
                    return;
                }
            } else {
                console.log("Planned action executed by LLM or interview ending.");
                setCurrentFollowUpStreak(0); setIsFollowUpActive(false); setCurrentFollowUpQuestionText(null); setPausedState(null);

                if (effectiveActionCode === ACTION_CODES.NEXT_QUESTION || effectiveActionCode === ACTION_CODES.NEXT_TOPIC) {
                    console.log(`Resetting attempts/history for newly asked planned Q: T${nextStateTopicIndex}, Q${nextStateQuestionIndex}`);
                    setCurrentQuestionAttempts(0);
                    currentQuestionHistory.current = [];
                }

                if (endInterview || effectiveActionCode === ACTION_CODES.END_INTERVIEW) {
                    console.log("Interview state transitioning to ENDED.");
                    setInterviewState('ENDED');
                    const lastMsg = conversation[conversation.length - 1];
                    if (!lastMsg || lastMsg.role !== 'interviewer' || (!lastMsg.content.toLowerCase().includes("thank") && !lastMsg.content.toLowerCase().includes("conclude"))) {
                        const fallbackClose = "Thank you for your time. This concludes the interview.";
                        console.warn("Adding fallback closing statement.");
                        setConversation(prev => [...prev, { role: 'system', content: "(System: Added fallback closing)" }, { role: 'interviewer', content: fallbackClose }]);
                        if (isVoiceEnabled) { const url = await generateTTS(fallbackClose); if(url) { audioQueueRef.current.push({url, text: fallbackClose}); if(!isProcessingAudioRef.current) setTimeout(playAudioQueue,0); }}
                    }
                } else {
                    setCurrentTopicIndex(nextStateTopicIndex);
                    setCurrentQuestionIndex(nextStateQuestionIndex);
                    console.log(`State updated to T${nextStateTopicIndex}, Q${nextStateQuestionIndex} after asking planned question.`);
                }
            }
        } catch (error) {
            console.error("Error during askQuestion process:", error);
            setErrorMessage(`Failed during Interviewer step: ${error.message}`);
            setConversation(prev => [...prev, { role: 'system', content: `Error: ${error.message}` }]);
            setInterviewState('ENDED');
        } finally {
            setIsLoading(false);
        }
    }, [interviewPlan, isVoiceEnabled, generateTTS, playAudioQueue, selectedVoice, speed, currentFollowUpStreak, isFollowUpActive, currentQuestionAttempts]);

    const handleStartInterview = useCallback(async (description) => {
        if (!description || description.trim() === '') {
            console.error("Start interview called without a job description.");
            setErrorMessage("Job description is missing.");
            return;
        }

        console.log("Attempting to start interview with provided job description...");
        setIsLoading(true); setInterviewState('PLANNING'); setErrorMessage(''); setConversation([]); setInterviewLog([]);
        setCurrentTopicIndex(0); setCurrentQuestionIndex(0); setCurrentQuestionAttempts(0);
        setIsFollowUpActive(false); setCurrentFollowUpQuestionText(null); setPausedState(null); setCurrentFollowUpStreak(0);
        lastInterviewerMessage.current = null; lastCandidateAnswer.current = null; lastDiscussionPoint.current = null;
        currentQuestionHistory.current = []; setInterviewPlan(null); setCandidateInput(''); setIsRecording(false); setFinalTranscript('');
        setIsEditorOpen(false); setCodeContent('');
        if (currentTTSAudio) { currentTTSAudio.pause(); setCurrentTTSAudio(null); }
        audioQueueRef.current.forEach(({ url }) => URL.revokeObjectURL(url)); audioQueueRef.current = [];
        isProcessingAudioRef.current = false; setIsTTSPlaying(false);
        console.log("Cleared state and TTS for new interview.");

        try {
            const plan = await callPlannerLlm(description);
            if (!plan?.topics || !Array.isArray(plan.topics) || plan.topics.length === 0 ||
                !plan.topics.every(t => t.name && Array.isArray(t.questions) && t.questions.length > 0)) {
                throw new Error("Planner returned an invalid or empty plan structure.");
            }
            console.log("Interview Plan Generated:", plan);
            setInterviewPlan(plan);
            setInterviewState('PLANNING_COMPLETE');
        } catch (error) {
            console.error("Interview Planning Error:", error);
            setErrorMessage(`Planning Failed: ${error.message}`);
            setConversation(prev => [...prev, { role: 'system', content: `Error during planning: ${error.message}` }]);
            setInterviewState('SETUP');
            setIsLoading(false);
        }
    }, []);

    const generateReport = useCallback(async () => {
        if (!interviewLog || interviewLog.length === 0) {
            setErrorMessage("No interview log available to generate a report.");
            return;
        }
        setIsReportLoading(true);
        setErrorMessage('');
        try {
            const logString = interviewLog.map((entry, index) => {
                const { topicIndex, questionIndex, metrics, actionCode, reason, discussion_point, type } = entry;
                return `Question ${index + 1} (Topic ${topicIndex}, Question ${questionIndex}, Type: ${type}):
Metrics: ${JSON.stringify(metrics, null, 2)}
Action: ${getActionCodeName(actionCode)}
Reason: ${reason}
${discussion_point ? `Discussion Point: ${discussion_point}` : ''}`;
            }).join('\n\n');
            const prompt = `Based on the following interview log, provide a detailed analysis report of the candidate's performance, including strengths, areas for improvement, and overall assessment. The log is as follows:\n\n${logString}`;
            const reportText = await callOllamaApi(prompt);
            setReport(reportText);
            setIsReportModalOpen(true);
        } catch (error) {
            console.error("Error generating report:", error);
            setErrorMessage(`Failed to generate report: ${error.message}`);
        } finally {
            setIsReportLoading(false);
        }
    }, [interviewLog]);

    const handleSubmitAnswer = useCallback(async () => {
        const textAnswer = (finalTranscript || candidateInput).trim();
        const codeToSend = codeContent.trim();
        if ((!textAnswer && !codeToSend) || isLoading || interviewState !== 'IN_PROGRESS') {
            console.log("Submit answer skipped: No input or invalid state."); return;
        }

        let combinedAnswer = textAnswer;
        if (codeToSend) {
            combinedAnswer += `\n\n**Code Snippet Provided:**\n\`\`\`\n${codeToSend}\n\`\`\``;
        }

        console.log(`Submitting answer (isFollowUp: ${isFollowUpActive}):`, combinedAnswer.substring(0, 100) + "...");
        setIsLoading(true); setCandidateInput(''); setFinalTranscript(''); setCodeContent(''); setIsEditorOpen(false); setErrorMessage('');

        setConversation(prev => [...prev, { role: 'candidate', content: combinedAnswer }]);
        lastCandidateAnswer.current = combinedAnswer;

        let contextTopicIdx, contextQuestionIdx, questionBeingAnswered;
        if (isFollowUpActive && pausedState) {
            contextTopicIdx = pausedState.topicIndex; contextQuestionIdx = pausedState.questionIndex;
            questionBeingAnswered = currentFollowUpQuestionText;
        } else if (interviewPlan?.topics[currentTopicIndex]?.questions[currentQuestionIndex]) {
            contextTopicIdx = currentTopicIndex; contextQuestionIdx = currentQuestionIndex;
            questionBeingAnswered = interviewPlan.topics[currentTopicIndex].questions[currentQuestionIndex];
        } else {
            console.error("Critical Error: Could not determine the question being answered. State:", { currentTopicIndex, currentQuestionIndex, isFollowUpActive, pausedState });
            setErrorMessage("Internal error: Could not associate answer with a question.");
            setIsLoading(false); setInterviewState("ENDED"); return;
        }

        const questionIdentifier = isFollowUpActive ? `Follow-up to T${contextTopicIdx}Q${contextQuestionIdx}` : `T${currentTopicIndex}Q${currentQuestionIndex}`;
        console.log(`Context for Monitor LLM: ${questionIdentifier}`);

        currentQuestionHistory.current.push({ question: questionBeingAnswered, answer: combinedAnswer });

        try {
            const monitorOutput = await callMonitorLlm(
                contextTopicIdx, contextQuestionIdx, questionBeingAnswered,
                combinedAnswer, [...currentQuestionHistory.current], isFollowUpActive
            );
            console.log(`Monitor Output (${questionIdentifier}):`, monitorOutput);
            setInterviewLog(prev => [...prev, { ...monitorOutput, type: isFollowUpActive ? 'follow-up' : 'planned' }]);
            lastDiscussionPoint.current = monitorOutput.discussion_point || null;

            if (isFollowUpActive && pausedState) {
                console.log("Processing follow-up answer. Resuming planned flow from:", pausedState);
                const { topicIndex: resumeTopicIdx, questionIndex: resumeQuestionIdx } = pausedState;
                setIsFollowUpActive(false); setCurrentFollowUpQuestionText(null); setPausedState(null);

                let nextPlannedAction = ACTION_CODES.NEXT_QUESTION;
                let nextPlannedTopicIdx = resumeTopicIdx;
                let nextPlannedQuestionIdx = resumeQuestionIdx + 1;

                if (!interviewPlan?.topics[nextPlannedTopicIdx]?.questions[nextPlannedQuestionIdx]) {
                    nextPlannedTopicIdx += 1; nextPlannedQuestionIdx = 0; nextPlannedAction = ACTION_CODES.NEXT_TOPIC;
                    if (!interviewPlan?.topics[nextPlannedTopicIdx]) {
                        nextPlannedAction = ACTION_CODES.END_INTERVIEW;
                        console.log("End of plan reached after resuming from follow-up.");
                    }
                }
                askQuestion(nextPlannedTopicIdx, nextPlannedQuestionIdx, nextPlannedAction);
            } else {
                console.log("Processing planned answer based on Monitor action code:", monitorOutput.actionCode);
                let nextActionCode = monitorOutput.actionCode;
                let nextTopicIndex = currentTopicIndex;
                let nextQuestionIndex = currentQuestionIndex;
                let currentAttempts = currentQuestionAttempts;

                if (nextActionCode === ACTION_CODES.REPEAT_QUESTION || nextActionCode === ACTION_CODES.CLARIFY_QUESTION) {
                    currentAttempts += 1;
                    setCurrentQuestionAttempts(currentAttempts);
                    if (currentAttempts >= MAX_ATTEMPTS_PLANNED) {
                        console.warn(`Max attempts (${currentAttempts}) reached for PLANNED Q${currentTopicIndex}-${currentQuestionIndex}. Forcing NEXT_QUESTION.`);
                        nextActionCode = ACTION_CODES.NEXT_QUESTION;
                    } else {
                        console.log(`Attempt ${currentAttempts}/${MAX_ATTEMPTS_PLANNED} for Q${currentTopicIndex}-${currentQuestionIndex}. Action: ${getActionCodeName(nextActionCode)}`);
                        nextTopicIndex = currentTopicIndex; nextQuestionIndex = currentQuestionIndex;
                    }
                }

                switch (nextActionCode) {
                    case ACTION_CODES.REPEAT_QUESTION: case ACTION_CODES.CLARIFY_QUESTION: break;
                    case ACTION_CODES.NEXT_QUESTION: nextQuestionIndex = currentQuestionIndex + 1; nextTopicIndex = currentTopicIndex; break;
                    case ACTION_CODES.NEXT_TOPIC: nextTopicIndex = currentTopicIndex + 1; nextQuestionIndex = 0; break;
                    case ACTION_CODES.END_INTERVIEW: console.log("Monitor requested END_INTERVIEW."); nextTopicIndex = currentTopicIndex; nextQuestionIndex = currentQuestionIndex; break;
                    default: console.error("Invalid action code received from Monitor:", monitorOutput.actionCode, ". Forcing END_INTERVIEW."); nextActionCode = ACTION_CODES.END_INTERVIEW; nextTopicIndex = currentTopicIndex; nextQuestionIndex = currentQuestionIndex; break;
                }
                askQuestion(nextTopicIndex, nextQuestionIndex, nextActionCode);
            }
        } catch (error) {
            console.error(`Error during Monitor processing for ${questionIdentifier}:`, error);
            setErrorMessage(`Failed during Monitor step: ${error.message}`);
            setIsLoading(false); setInterviewState('ENDED');
        }
    }, [candidateInput, finalTranscript, codeContent, isLoading, interviewState, interviewPlan, currentTopicIndex, currentQuestionIndex, askQuestion, currentQuestionAttempts, isFollowUpActive, currentFollowUpQuestionText, pausedState]);

    const handleToggleRecording = useCallback(() => {
        if (!recognitionAvailable) {
            setErrorMessage("Speech recognition is not available in this browser.");
            return;
        }

        if (isRecording) {
            if (recognitionInstance.current && !isStopping) {
                console.log("Attempting to stop speech recognition...");
                setIsStopping(true);
                recognitionInstance.current.stop();
                if (micStream) {
                    micStream.getTracks().forEach(track => track.stop());
                    setMicStream(null);
                    console.log("Microphone stream tracks stopped manually.");
                }
                setTimeout(() => {
                    if (isStopping) {
                        console.warn("Recognition 'onend' not fired within 2s. Forcing state cleanup.");
                        setIsRecording(false); setIsStopping(false);
                        recognitionInstance.current = null;
                        if (micStream) { try { micStream.getTracks().forEach(track => track.stop()); setMicStream(null); } catch(e){} }
                    }
                }, 2000);
            } else {
                console.log("Stop recording ignored: No instance or already stopping.");
            }
        } else {
            if (isLoading || isStopping || isEditorOpen) {
                console.log("Start recording prevented: Busy, stopping, or editor open.");
                return;
            }

            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    console.log("Microphone access granted.");
                    setMicStream(stream);
                    setCandidateInput(''); setFinalTranscript(''); setErrorMessage('');

                    recognitionInstance.current = new SpeechRecognition();
                    recognitionInstance.current.continuous = true;
                    recognitionInstance.current.interimResults = true;
                    recognitionInstance.current.lang = 'en-US';

                    let currentFinal = '';

                    recognitionInstance.current.onresult = (event) => {
                        let interim = '';
                        currentFinal = '';
                        for (let i = 0; i < event.results.length; ++i) {
                            if (event.results[i].isFinal) {
                                currentFinal += event.results[i][0].transcript + ' ';
                            } else {
                                if (i === event.results.length - 1) {
                                    interim += event.results[i][0].transcript;
                                }
                            }
                        }
                        setCandidateInput(currentFinal + interim);
                        if (currentFinal.trim()) {
                            setFinalTranscript(currentFinal.trim());
                        }
                    };

                    recognitionInstance.current.onerror = (event) => {
                        console.error('Speech recognition error:', event.error, event.message);
                        let errorMsg = `Speech error: ${event.message || event.error}`;
                        setErrorMessage(errorMsg);
                        setIsRecording(false); setIsStopping(false);
                        if (micStream) { try { micStream.getTracks().forEach(track => track.stop()); setMicStream(null); } catch(e){} }
                        recognitionInstance.current = null;
                    };

                    recognitionInstance.current.onend = () => {
                        console.log("Speech recognition ended.");
                        setIsRecording(false); setIsStopping(false);
                        recognitionInstance.current = null;
                        console.log("Final Transcript State on end:", finalTranscript);
                    };

                    recognitionInstance.current.start();
                    console.log("Speech recognition started.");
                    setIsRecording(true);
                })
                .catch(error => {
                    console.error("Failed to get microphone stream:", error);
                    setErrorMessage(`Could not access microphone: ${error.message}. Please check browser permissions.`);
                    setIsRecording(false); setIsStopping(false); setMicStream(null);
                });
        }
    }, [isRecording, isLoading, isStopping, isEditorOpen, micStream, finalTranscript]);

    const visualizerMode = useMemo(() => {
        if (interviewState === 'SETUP' || interviewState === 'ENDED') return "static";
        if (interviewState === 'PLANNING' || interviewState === 'PLANNING_COMPLETE') return "think";
        if (interviewState === 'IN_PROGRESS') {
            if (isRecording) return "play";
            if (isTTSPlaying) return "play";
            if (isLoading) return "think";
            return "static";
        }
        return "static";
    }, [interviewState, isRecording, isTTSPlaying, isLoading]);

    const visualizerAudioSource = useMemo(() => {
        if (visualizerMode === "play") {
            if (isRecording && micStream) return micStream;
            else if (isTTSPlaying && currentTTSAudio) return currentTTSAudio;
        }
        return null;
    }, [visualizerMode, isRecording, micStream, isTTSPlaying, currentTTSAudio]);

    return (
        <div style={styles.appContainer}>
            <header style={styles.header}>
                <h1>AI Interviewer</h1>
                <div style={styles.controlsGroup}>
                    {voices.length > 0 && (
                        <>
                            <label htmlFor="voice-select" style={styles.controlLabel}>Voice:</label>
                            <select
                                id="voice-select"
                                value={selectedVoice}
                                onChange={(e) => setSelectedVoice(e.target.value)}
                                style={styles.controlSelect}
                                disabled={isLoading || isTTSPlaying}
                                title="Select TTS Voice"
                            >
                                {voices.map(voice => (
                                    <option key={voice} value={voice}>{voice.split('(')[0]}</option>
                                ))}
                            </select>
                            <label htmlFor="speed-input" style={styles.controlLabel}>Speed:</label>
                            <input
                                id="speed-input" type="range" min="0.5" max="2" step="0.1"
                                value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}
                                style={styles.controlSlider}
                                disabled={isLoading || isTTSPlaying}
                                title={`Playback Speed: ${speed.toFixed(1)}x`}
                            />
                            <span style={styles.speedDisplay}>{speed.toFixed(1)}x</span>
                        </>
                    )}
                    <button
                        onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
                        style={{...styles.controlButton, ...(isVoiceEnabled ? styles.ttsButtonActive : styles.ttsButtonInactive)}}
                        title={isVoiceEnabled ? 'Disable TTS' : 'Enable TTS'}
                        disabled={voices.length === 0}
                    >
                        TTS
                    </button>
                    <span style={styles.statusIndicator}>Ollama: {OLLAMA_MODEL}</span>
                </div>
            </header>
            <style>
                {`
                .chat-box {
                    scrollbar-width: thin;
                    scrollbar-color: #888 transparent;
                }
                .chat-box::-webkit-scrollbar {
                    width: 2px;
                }
                .chat-box::-webkit-scrollbar-thumb {
                    background-color: #888;
                    border-radius: 1px;
                }
                .chat-box::-webkit-scrollbar-track {
                    background: transparent;
                }
                `}
            </style>
            <div style={styles.card}>
                {currentMode === 'convo' && (
                    <div style={{ width: '100%', height: '60vh', display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '20px' }}>
                        <DotAudioVisualizer mode={visualizerMode} audioSource={visualizerAudioSource} />
                    </div>
                )}

                {interviewState === 'SETUP' && (
                    <div>
                        <h2>Setup Interview</h2>
                        {errorMessage && <p style={styles.errorText}>{errorMessage}</p>}
                        <button onClick={() => navigate('/')} style={styles.buttonPrimary}>Go to Landing Page</button>
                    </div>
                )}

                {interviewState === 'PLANNING' && (
                    <>
                        <h2>Setting Up Interview</h2>
                        <p>Generating interview plan based on the provided job description...</p>
                        <div style={styles.loadingSpinner}></div>
                    </>
                )}

                {(interviewState === 'IN_PROGRESS' || interviewState === 'ENDED' || interviewState === 'PLANNING_COMPLETE') && (
                    <>
                        {currentMode === 'chat' && (
                            <div ref={chatContainerRef} className="chat-box" style={styles.chatBox}>
                                {conversation.map((msg, index) => (
                                    <div key={index} style={getMessageStyle(msg.role, msg.content === currentFollowUpQuestionText && isFollowUpActive)}>
                                        <strong style={styles.messageRole}>
                                            {msg.role === 'interviewer' ? 'Interviewer' : (msg.role === 'candidate' ? 'You' : 'System')}
                                            {msg.role === 'interviewer' && msg.content === currentFollowUpQuestionText && isFollowUpActive && <span style={styles.followUpIndicator}> (Follow-up)</span>}
                                        </strong>
                                        {typeof msg.content === 'string' && msg.content.includes('```') ? (
                                            msg.content.split(/(```[\s\S]*?```)/g).map((part, i) => {
                                                if (part.startsWith('```') && part.endsWith('```')) {
                                                    const languageMatch = part.match(/^```(\w+)\n/);
                                                    const code = languageMatch ? part.substring(languageMatch[0].length, part.length - 3).trim() : part.substring(3, part.length - 3).trim();
                                                    return <pre key={i} style={styles.codeBlock}>{code}</pre>;
                                                } else {
                                                    return part.split('\n').map((line, j) => <span key={`${i}-${j}`} style={{ display: 'block' }}>{line}</span>);
                                                }
                                            })
                                        ) : (
                                            typeof msg.content === 'string' ? msg.content.split('\n').map((line, i) => <span key={i} style={{ display: 'block' }}>{line}</span>) : <span>{JSON.stringify(msg.content)}</span>
                                        )}
                                    </div>
                                ))}
                                {isLoading && interviewState === 'IN_PROGRESS' && !lastCandidateAnswer.current && (
                                    <div style={styles.loadingIndicator}><i>Interviewer is thinking...</i></div>
                                )}
                                {isLoading && interviewState === 'IN_PROGRESS' && lastCandidateAnswer.current && (
                                    <div style={styles.loadingIndicator}><i>Evaluating answer{isFollowUpActive ? " (Follow-up)" : ""}...</i></div>
                                )}
                            </div>
                        )}

                        {interviewLog.length > 0 && currentMode === 'chat' && (
                            <div style={styles.monitorFeedback}>
                                <details>
                                    <summary style={styles.monitorSummary}>
                                        Last Eval ({interviewLog[interviewLog.length - 1].type || 'planned'})
                                        - Action: {getActionCodeName(interviewLog[interviewLog.length - 1].actionCode)}
                                        - Reason: {interviewLog[interviewLog.length - 1].reason}
                                        {interviewLog[interviewLog.length - 1].discussion_point && ` | Suggestion: ${interviewLog[interviewLog.length - 1].discussion_point}`}
                                    </summary>
                                    <pre style={styles.monitorDetails}>
                                        Metrics: {JSON.stringify(interviewLog[interviewLog.length - 1].metrics || {}, null, 2)}
                                    </pre>
                                </details>
                            </div>
                        )}

                        {interviewLog.length > 0 && (
                            <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                                <button onClick={generateReport} disabled={isReportLoading} style={isReportLoading ? styles.buttonDisabled : styles.buttonPrimary}>
                                    {isReportLoading ? 'Generating Report...' : 'Analysis Report'}
                                </button>
                            </div>
                        )}

                        {interviewState === 'IN_PROGRESS' && (
                            <>
                                {isEditorOpen && (
                                    <div style={styles.editorOverlay}>
                                        <div style={styles.editorContainer} onClick={(e)=>e.stopPropagation()}>
                                            <h4 style={styles.editorTitle}>Code Editor</h4>
                                            <Editor
                                                height="300px"
                                                language="javascript" theme="vs-dark"
                                                value={codeContent} onChange={(value) => setCodeContent(value || '')}
                                                options={{ minimap: { enabled: false }, wordWrap: 'on' }}
                                            />
                                            <button
                                                onClick={() => setIsEditorOpen(false)}
                                                style={{...styles.buttonBase, ...styles.buttonSecondary, marginTop: '10px'}}
                                            >
                                                Close Editor
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div style={styles.inputArea}>
                                    <textarea
                                        rows="3"
                                        placeholder={
                                            isRecording ? "Listening..." :
                                            (isEditorOpen ? "Add comments or context..." :
                                            (isFollowUpActive ? "Answer the follow-up..." : "Type or record answer..."))
                                        }
                                        value={candidateInput}
                                        onChange={(e) => { setCandidateInput(e.target.value); if (finalTranscript) setFinalTranscript(''); }}
                                        disabled={isLoading || isRecording || isStopping || isEditorOpen}
                                        style={styles.textareaInput}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey && !isLoading && !isRecording && !isStopping && !isEditorOpen) {
                                                e.preventDefault(); handleSubmitAnswer();
                                            }
                                        }}
                                    />
                                    <div style={styles.buttonGroup}>
                                        <button
                                            onClick={() => setIsEditorOpen(!isEditorOpen)}
                                            disabled={isLoading || isRecording || isStopping}
                                            style={(isLoading || isRecording || isStopping) ? styles.buttonDisabled : styles.buttonCode}
                                            title={isEditorOpen ? "Close Code Editor" : "Open Code Editor"}
                                        >
                                            {isEditorOpen ? '</> Close' : '</> Code'}
                                        </button>
                                        {recognitionAvailable && (
                                            <button
                                                onClick={handleToggleRecording}
                                                disabled={isLoading || isEditorOpen || isStopping}
                                                style={isRecording ? styles.buttonRecording : (isLoading || isEditorOpen || isStopping ? styles.buttonDisabled : styles.buttonSecondary)}
                                                title={isRecording ? "Stop Recording" : "Record Answer"}
                                            >
                                                {isRecording ? 'Stop' : (isStopping ? 'Stopping...' : 'Record')}
                                            </button>
                                        )}
                                        <button
                                            onClick={handleSubmitAnswer}
                                            disabled={isLoading || isRecording || isStopping || (!candidateInput.trim() && !codeContent.trim())}
                                            style={(isLoading || isRecording || isStopping || (!candidateInput.trim() && !codeContent.trim())) ? styles.buttonDisabled : styles.buttonSuccess}
                                        >
                                            {isLoading ? 'Processing...' : 'Send Answer'}
                                        </button>
                                    </div>
                                    {errorMessage && interviewState === 'IN_PROGRESS' && <p style={{...styles.errorText, width: '100%', textAlign: 'center'}}>{errorMessage}</p>}
                                </div>
                            </>
                        )}

                        {interviewState === 'ENDED' && (
                            <div style={{ textAlign: 'center' }}>
                                <h2>Interview Ended</h2>
                                {errorMessage && <p style={styles.errorText}>{errorMessage}</p>}
                                <button onClick={() => navigate('/')} style={{...styles.buttonBase, ...styles.buttonPrimary, marginTop: '15px'}}>Start New Interview</button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {isReportModalOpen && (
                <div style={styles.overlayStyles} onClick={() => setIsReportModalOpen(false)}>
                    <div style={styles.modalStyles} onClick={(e) => e.stopPropagation()}>
                        <h2>Analysis Report</h2>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.9em' }}>{report}</pre>
                        <button onClick={() => setIsReportModalOpen(false)} style={{ ...styles.buttonBase, ...styles.buttonSecondary, marginTop: '10px' }}>Close</button>
                    </div>
                </div>
            )}

            <div style={styles.modeSwitcher}>
                <button
                    onClick={() => setCurrentMode('convo')}
                    style={{ ...styles.buttonMode, ...(currentMode === 'convo' ? styles.buttonActive : styles.buttonInactive) }}
                >
                    Convo Mode
                </button>
                <button
                    onClick={() => setCurrentMode('chat')}
                    style={{ ...styles.buttonMode, ...(currentMode === 'chat' ? styles.buttonActive : styles.buttonInactive) }}
                >
                    Chat Mode
                </button>
            </div>
        </div>
    );
}

// --- Styling ---
const styles = {
    appContainer: {
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        backgroundColor: '#000', color: '#fff', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', alignItems: 'center',
        padding: '20px', boxSizing: 'border-box', overflow: 'hidden',
        fontFamily: "'Roboto', 'Segoe UI', 'Helvetica Neue', sans-serif",
    },
    header: {
        width: '100%', textAlign: 'center', marginBottom: '20px', color: '#fff'
    },
    controlsGroup: {
        display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center'
    },
    controlLabel: {
        fontSize: '0.9em', color: '#ccc'
    },
    controlSelect: {
        padding: '4px 8px', borderRadius: '10px',
        border: '1px solid #555', backgroundColor: '#333', color: '#fff', cursor: 'pointer'
    },
    controlSlider: {
        width: '100px', cursor: 'pointer', accentColor: '#eee'
    },
    controlButton: {
        padding: '5px 10px', backgroundColor: '#333', color: '#fff',
        border: '1px solid #555', borderRadius: '10px',
        cursor: 'pointer', fontSize: '1.1em', lineHeight: 1
    },
    ttsButtonActive: {
        backgroundColor: '#28a745', borderColor: '#1c7430'
    },
    ttsButtonInactive: {
        backgroundColor: '#5a6268', borderColor: '#4e555b'
    },
    speedDisplay: {
        fontSize: '0.85em', color: '#ccc', minWidth: '35px', textAlign: 'right'
    },
    statusIndicator: {
        fontSize: '0.85em', color: '#aaa', backgroundColor: '#222',
        padding: '3px 8px', borderRadius: '12px'
    },
    card: {
        flexGrow: 1,
        width: '100%',
        maxWidth: '900px',
        backgroundColor: 'rgba(17, 17, 17, 0.8)',
        padding: '20px', color: '#fff',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        boxSizing: 'border-box', overflowY: 'auto',
        borderRadius: '8px',
        border: '1px solid #333',
        backdropFilter: 'blur(5px)',
        marginBottom: '70px',
    },
    textareaSetup: {
        width: '80%', maxWidth: '800px', padding: '10px',
        borderRadius: '10px',
        border: '1px solid #555', backgroundColor: '#333', color: '#fff', marginBottom: '15px',
        fontSize: '1em', resize: 'vertical'
    },
    buttonBase: {
        padding: '10px 15px', cursor: 'pointer', borderRadius: '10px', border: 'none',
        fontSize: '0.95em', fontWeight: '500', transition: 'background-color 0.2s ease, opacity 0.2s ease'
    },
    buttonPrimary: {
        backgroundColor: '#007bff', color: '#fff', '&:hover': { backgroundColor: '#0056b3' }
    },
    buttonDisabled: {
        backgroundColor: '#555', color: '#aaa', cursor: 'not-allowed', opacity: 0.7
    },
    errorText: {
        color: '#ff6b6b', marginTop: '10px'
    },
    chatBox: {
        width: '95%',
        maxWidth: '800px', maxHeight: '50vh',
        overflowY: 'auto', backgroundColor: 'rgba(34, 34, 34, 0.7)',
        padding: '15px', borderRadius: '8px', color: '#fff', marginBottom: '20px'
    },
    messageInterviewer: {
        backgroundColor: '#004d40', padding: '10px', borderRadius: '8px', marginBottom: '10px',
        marginRight: 'auto', maxWidth: '85%', borderBottomLeftRadius: '2px'
    },
    messageCandidate: {
        backgroundColor: '#3e2723', padding: '10px', borderRadius: '8px', marginBottom: '10px',
        marginLeft: 'auto', maxWidth: '85%', borderBottomRightRadius: '2px'
    },
    messageSystem: {
        color: '#ccc', fontStyle: 'italic', textAlign: 'center', fontSize: '0.9em', margin: '10px auto'
    },
    messageRole: {
        display: 'block', marginBottom: '5px', fontSize: '0.8em', fontWeight: 'bold', color: '#aaa', opacity: '0.8',
    },
    inputArea: {
        width: '95%', maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '10px',
        marginTop: 'auto'
    },
    textareaInput: {
        width: '100%', padding: '10px', borderRadius: '10px',
        border: '1px solid #555', backgroundColor: '#333', color: '#fff',
        fontSize: '1em', resize: 'vertical', boxSizing: 'border-box'
    },
    buttonGroup: {
        display: 'flex', justifyContent: 'flex-end',
        gap: '10px', flexWrap: 'wrap'
    },
    buttonSecondary: {
        backgroundColor: '#6c757d', color: '#fff', '&:hover': { backgroundColor: '#5a6268' }
    },
    buttonRecording: {
        backgroundColor: '#dc3545', color: '#fff', '&:hover': { backgroundColor: '#c82333' },
        animation: 'pulse 1.5s infinite',
    },
    buttonSuccess: {
        backgroundColor: '#28a745', color: '#fff', '&:hover': { backgroundColor: '#218838' }
    },
    buttonCode: {
        backgroundColor: '#17a2b8', color: '#fff', '&:hover': { backgroundColor: '#138496' }
    },
    modeSwitcher: {
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: '10px', zIndex: 100
    },
    buttonMode: {
        padding: '10px 20px', backgroundColor: '#333', color: '#fff',
        border: '1px solid #555', borderRadius: '10px', cursor: 'pointer',
        transition: 'background-color 0.2s ease'
    },
    buttonActive: {
        backgroundColor: '#007bff', borderColor: '#0056b3'
    },
    buttonInactive: {
        backgroundColor: '#555', borderColor: '#444'
    },
    loadingSpinner: {
        width: '40px', height: '40px', border: '4px solid #555',
        borderTop: '4px solid #fff',
        borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '20px auto'
    },
    editorOverlay: {
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.8)', display: 'flex',
        justifyContent: 'center', alignItems: 'center', zIndex: 1000
    },
    editorContainer: {
        width: '80%', maxWidth: '800px', backgroundColor: '#222',
        padding: '20px', borderRadius: '8px', border: '1px solid #444'
    },
    editorTitle: {
        color: '#fff', marginBottom: '15px', borderBottom: '1px solid #444', paddingBottom: '10px'
    },
    monitorFeedback: {
        width: '95%', maxWidth: '800px', marginBottom: '20px',
        backgroundColor: 'rgba(40, 40, 40, 0.7)', padding: '10px', borderRadius: '6px'
    },
    monitorSummary: {
        color: '#ccc', cursor: 'pointer', fontWeight: 'normal', padding: '5px'
    },
    monitorDetails: {
        backgroundColor: '#333', padding: '10px', borderRadius: '4px',
        color: '#eee', marginTop: '5px', overflowX: 'auto', fontSize: '0.9em'
    },
    followUpIndicator: {
        color: '#ffd700', fontSize: '0.9em', fontStyle: 'italic', marginLeft: '5px'
    },
    codeBlock: {
        backgroundColor: '#444', padding: '10px', borderRadius: '4px',
        overflowX: 'auto', margin: '5px 0',
        fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
        fontSize: '0.9em'
    },
    loadingIndicator: {
        color: '#aaa', fontStyle: 'italic', textAlign: 'center', margin: '15px 0'
    },
    reportContainer: {
        marginTop: '20px',
        backgroundColor: '#333',
        padding: '15px',
        borderRadius: '8px',
        maxHeight: '300px',
        overflowY: 'auto',
        color: '#fff',
    },
    reportText: {
        whiteSpace: 'pre-wrap',
        fontSize: '0.95em',
    },
    overlayStyles: {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 999,
    },
    modalStyles: {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: '#222',
        padding: '20px',
        borderRadius: '8px',
        maxWidth: '80%',
        maxHeight: '80%',
        overflowY: 'auto',
        zIndex: 1000,
        color: '#fff',
    },
};

const getMessageStyle = (role, isCurrentFollowUp) => {
    let baseStyle = {};
    if (role === 'interviewer') baseStyle = styles.messageInterviewer;
    else if (role === 'candidate') baseStyle = styles.messageCandidate;
    else baseStyle = styles.messageSystem;
    if (isCurrentFollowUp && role === 'interviewer') {
        return { ...baseStyle, border: '2px solid #ffd700', boxShadow: '0 0 5px #ffd700' };
    }
    return baseStyle;
};

try {
    const styleSheet = document.styleSheets[0] || document.head.appendChild(document.createElement('style')).sheet;
    let spinExists = false; let pulseExists = false;
    for (let i = 0; i < styleSheet.cssRules.length; i++) {
        if (styleSheet.cssRules[i].name === 'spin') spinExists = true;
        if (styleSheet.cssRules[i].name === 'pulse') pulseExists = true;
    }
    if (!spinExists) { styleSheet.insertRule(`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`, styleSheet.cssRules.length); }
    if (!pulseExists) { styleSheet.insertRule(`@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(220, 53, 69, 0); } 100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); } }`, styleSheet.cssRules.length); }
} catch (e) { console.warn("Could not insert CSS keyframes: ", e); }

export default InterviewPage;