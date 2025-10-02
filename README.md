🤖 OpenInterviewAI: Adaptive Technical Mock Interview PlatformOpenInterviewAI is an open-source, LLM-powered system that simulates a highly skilled, adaptive human interviewer. Built using the Ollama framework for flexible model execution, it dynamically generates an interview plan based on a job description, conducts the interview using natural language and voice (Kokoro TTS), and provides detailed, objective feedback.🌟 FeaturesAdaptive Flow (LLM-Driven): Real-time monitoring and dynamic adjustment of the conversation (repeat, clarify, next topic) based on the candidate's response quality, managed entirely by the integrated LLM logic.Voice-Enabled Interviewer: Integrates Kokoro TTS for natural, realistic audio interaction.Targeted Planning: Perplixica pre-processes job descriptions to ensure the generated questions are highly relevant to the required competencies, with core logic provided by the LLM.Metric-Based Feedback: Provides detailed metrics (accuracy, confidence, relevance, completeness, clarity) for every response, using the LLM for objective assessment.🏗️ System Architecture: The Adaptive LoopThe entire system runs as a continuous loop, with the Monitor acting as the central decision engine that dictates the flow.ComponentRoleLLM DependencyInputOutputPerplixicaInput Pre-Processor. Refines raw job description into core competency areas.Generation/ReasoningJob Description (Text)Refined Competency ListPlannerInterview Designer. Generates the structured InterviewPlan.Generation/ReasoningRefined Competency ListInterviewPlan (JSON)InterviewerConversation Manager. Asks questions naturally, powered by Kokoro TTS.GenerationInterviewPlan, MonitorOutput.actionCodeNatural Language Question (Text/Audio)MonitorReal-time Assessor. Evaluates candidate responses and determines the next action.Assessment/ScoringCandidate Answer, Current QuestionMonitorOutput (JSON)Log EngineData Persistence. Records all assessment data for final reports.NoneMonitorOutput (JSON)Logged Data (Database/File)LLM Integration NotesAll core components rely on a Large Language Model (LLM) for processing, generation, and assessment. This project is configured to use the Ollama framework for local and flexible model management, ensuring the platform remains open-source and customizable.🛠️ Local Setup and DependenciesTo get OpenInterviewAI running, you need the core application and the external voice service.1. Core Repository SetupClone the project:git clone [https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git](https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git)
cd YOUR_REPO_NAME

Install Python dependencies:# It is highly recommended to use a virtual environment
pip install -r requirements.txt

Configure LLM and Environment:Ollama Setup: Ensure the Ollama service is installed and running locally on its default port (http://localhost:11434). The application connects directly to the Ollama API endpoint.Model Selection: Specify the LLM model name (e.g., mistral, llama3) in the application's configuration (usually via an environment variable like LLM_MODEL_NAME).Kokoro TTS: Set the local endpoint for the Kokoro TTS service (KOKORO_TTS_URL).2. Voice Feature Integration (Kokoro TTS)The Interviewer component uses the Kokoro TTS Web UI for generating natural voice output.Install Kokoro TTS Web UI:Follow the installation and setup guide for the Kokoro TTS Web UI project.Ensure the service is running on the port configured in your environment variables.Apply Custom Integration:This repository includes a custom application file (e.g., app.py in the main directory) that contains the necessary logic to communicate with and control the Kokoro TTS service. Ensure your running TTS instance is configured to use this custom application logic.📌 Key Data StructuresInterviewPlan (Planner Output)The structural guide for the interview.{
  "topics": [
    {
      "name": "React",
      "questions": [
        "What is a React component?",
        "How do props work in React?",
        // ... more questions
      ]
    }
  ]
}

MonitorOutput (Monitor Output)The assessment result and instruction for the next action.{
  "topicIndex": 1,
  "questionIndex": 0,
  "metrics": {
    "accuracy": 0.8, 
    "confidence": 0.9, 
    "relevance": 0.9, 
    "completeness": 0.7, 
    "clarity": 0.8 
  },
  "actionCode": 3,
  "reason": "Answer is technically correct but could mention server-side use."
}

Action Codes (The Flow Control):CodeActionFlow Change1RepeatRepeat the exact question (used for very poor/incomplete answers).2ClarifyAsk for more detail or elaboration on the current question.3Next QuestionMove to the next question in the current topic.4Next TopicMove to the first question of the next available topic.5EndTerminate the interview session.🔁 Operational Flow WalkthroughThe detailed step-by-step logic is critical for contributors to understand how the system manages the conversation dynamically.StepTopicQuestionCandidate Response QualityAction CodeReason1ReactQ1Vague. "It's a part of the UI."2 (Clarify)Lacks technical detail.2ReactQ1Better. "A function returning JSX..."3 (Next Question)Sufficiently detailed.3ReactQ2Incomplete. "Stores data."1 (Repeat)Misses re-rendering detail.4ReactQ2Excellent. "State holds data, and when it changes, the component re-renders."4 (Next Topic)Topic is mastered.5Node.jsQ1Satisfactory. "Runtime built on V8."3 (Next Question)Good, but needs to keep moving.6Node.jsQ3Final Q. "Lists dependencies."5 (End)Interview complete.🤝 ContributingWe welcome contributions of all kinds! Whether it's reporting bugs, suggesting features, or submitting code, please see our guides below:CONTRIBUTING.md: Guidelines for submitting pull requests.CODE_OF_CONDUCT.md: Our community standards.📄 LicenseThis project is licensed under the MIT License - see the LICENSE file for details.
