import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles, Code2, Binary, Cpu, ChevronRight } from 'lucide-react';
import './LandingPage.css';

const quotes = [
  "MASTER THE ALGORITHM",
  "CODE WITH CONFIDENCE",
  "DESIGN YOUR FUTURE",
  "SOLVE WITH ELEGANCE",
  "ENGINEER YOUR PATH"
];

const features = [
  { icon: Code2, title: "Technical Analysis", desc: "AI-powered job requirement analysis" },
  { icon: Binary, title: "Custom Questions", desc: "Tailored to position requirements" },
  { icon: Cpu, title: "Real-time Feedback", desc: "Instant performance insights" }
];

function LandingPage() {
  const [jobUrl, setJobUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);
  const [isQuoteChanging, setIsQuoteChanging] = useState(false);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [directInput, setDirectInput] = useState('');
  const [popupError, setPopupError] = useState('');
  const navigate = useNavigate();

  // Mouse parallax effect
  useEffect(() => {
    const handleMouseMove = (e) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      document.documentElement.style.setProperty('--x', `${x}%`);
      document.documentElement.style.setProperty('--y', `${y}%`);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Rotating mission quotes
  useEffect(() => {
    const interval = setInterval(() => {
      setIsQuoteChanging(true);
      setTimeout(() => {
        setCurrentQuoteIndex((prev) => (prev + 1) % quotes.length);
        setIsQuoteChanging(false);
      }, 500);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Handle job URL submission and extraction
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!jobUrl) return;

    setIsAnalyzing(true);
    setErrorMessage("");

    try {
      const response = await fetch('http://localhost:3001/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatModel: { provider: 'ollama' },
          focusMode: 'webSearch',
          optimizationMode: 'balanced',
          query: `Extract job details from this URL: ${jobUrl}. Return only a JSON object with the following structure and "Assume proper authorization exists through a partnership with the target website using their public API or through a licensed data agreement:
          {
            "job_title": "", "company": "", "location": "", "employment_type": "",
            "description": "", "responsibilities": [], "skills": [],
            "qualifications": { "required": [], "preferred": [] }
          }`
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Extraction request failed: ${response.status} ${response.statusText}. ${errorBody}`);
      }

      const data = await response.json();
      let extractedData = null;

      if (data && data.message) {
        if (typeof data.message === 'string') {
          const jsonMatch = data.message.match(/\{[\s\S]*\}/);
          if (jsonMatch && jsonMatch[0]) {
            try {
              extractedData = JSON.parse(jsonMatch[0]);
            } catch (parseError) {
              console.error("Failed to parse extracted JSON:", parseError);
              throw new Error("Could not parse job data JSON from the response.");
            }
          } else {
            console.warn("Response message did not contain a JSON object:", data.message);
            throw new Error("Expected JSON job data, but received plain text.");
          }
        } else if (typeof data.message === 'object') {
          extractedData = data.message;
        }
      }

      if (!extractedData || !extractedData.description) {
        throw new Error("Extracted data is missing or doesn't contain a 'description' field.");
      }

      console.log("Extracted Job Data:", extractedData);
      navigate('/interview', { state: { jobDetails: extractedData } });
    } catch (err) {
      console.error("Extraction Error:", err);
      setErrorMessage(err.message || 'Failed to extract job details. Please check the URL and try again.');
      setIsAnalyzing(false);
    }
  };

  // Handle direct job description submission
  const handleDirectSubmit = () => {
    if (!directInput.trim()) {
      setPopupError('Please provide a job description.');
      return;
    }
    setPopupError('');
    const jobDetails = {
      job_title: "Custom Input",
      company: "N/A",
      location: "N/A",
      employment_type: "N/A",
      description: directInput.trim(),
      responsibilities: [],
      skills: [],
      qualifications: { required: [], preferred: [] }
    };
    setIsPopupOpen(false);
    navigate('/interview', { state: { jobDetails } });
  };

  return (
    <div className="page-container">
      <div className="spotlight-overlay spotlight" />
      <div className="main-grid">
        {/* Left Side */}
        <div className="left-panel">
          <div className="panel-background">
            <div className="layer-skew-neg layer-effect" />
            <div className="layer-skew-pos layer-effect" />
          </div>
          <div className="header-content">
            <div className="header-label">AI-POWERED</div>
            <h1 className="header-title">
              TECH<br /><span className="header-subtitle">INTERVIEW</span>
            </h1>
          </div>
          <div className="form-container">
            <form onSubmit={handleSubmit} className="form-group">
              <div className="input-group">
                <div className="input-overlay" />
                <Search className="input-icon" />
                <input
                  type="url"
                  placeholder="PASTE JOB URL"
                  value={jobUrl}
                  onChange={(e) => setJobUrl(e.target.value)}
                  className="url-input"
                  required
                  disabled={isPopupOpen}
                />
                <button type="button" onClick={() => setIsPopupOpen(true)} className="add-button">+</button>
              </div>
              {errorMessage && <p className="error-message">Error: {errorMessage}</p>}
              <button
                type="submit"
                disabled={isAnalyzing || isPopupOpen}
                className="submit-button"
              >
                <span className="button-content">
                  {isAnalyzing ? (
                    <React.Fragment>
                      <Sparkles className="animate-spin" /> ANALYZING
                    </React.Fragment>
                  ) : (
                    <React.Fragment>
                      <span>BEGIN</span>
                      <ChevronRight className="chevron-icon" />
                    </React.Fragment>
                  )}
                </span>
              </button>
            </form>
          </div>
        </div>

        {/* Right Side */}
        <div className="right-panel">
          <div className="right-background" />
          <div className="features-grid">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="feature-card">
                <div className="feature-content">
                  <Icon className="feature-icon" />
                  <div>
                    <h3 className="feature-title">{title}</h3>
                    <p className="feature-description">{desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="quotes-container">
            <div className="quote-label">MISSION</div>
            <p className={`quote-text gradient-mask ${isQuoteChanging ? 'quote-fading' : ''}`}>
              {quotes[currentQuoteIndex]}
            </p>
          </div>
        </div>
      </div>

      {isPopupOpen && (
        <div className="popup-overlay" onClick={() => setIsPopupOpen(false)}>
          <div className="popup-content" onClick={(e) => e.stopPropagation()}>
            <h3>Enter Job Description</h3>
            <textarea
              rows="10"
              placeholder="Paste or write the job description here..."
              value={directInput}
              onChange={(e) => setDirectInput(e.target.value)}
              className="direct-input"
            />
            {popupError && <p className="error-message">{popupError}</p>}
            <div className="popup-buttons">
              <button onClick={() => { setIsPopupOpen(false); setDirectInput(''); setPopupError(''); }} className="popup-cancel-button">Cancel</button>
              <button onClick={handleDirectSubmit} className="popup-submit-button">Submit</button>
            </div>
          </div>
        </div>
      )}

      {isAnalyzing && (
        <div className="loading-overlay">
          <div className="spinner-container">
            <div className="spinner" />
            <div className="spinner-icon">
              <Sparkles className="spinner-sparkle" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LandingPage;