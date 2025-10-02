import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import LandingPage from './components/LandingPage'; // Assuming 1stpage.txt is renamed/refactored
import InterviewPage from './components/InterviewPage'; // Assuming bbbb.txt is renamed/refactored
//import './index.css'; // Assuming you have global styles

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/interview" element={<InterviewPage />} />
      </Routes>
    </Router>
  );
}

export default App;