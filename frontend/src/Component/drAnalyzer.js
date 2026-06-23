import React, { useState, useEffect, useRef } from 'react';
import './drAnalyzer.css';

import { jsPDF } from 'jspdf';

function generatePDF(title, text) {
  const doc = new jsPDF();
  
  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  const titleLines = doc.splitTextToSize(title, 170);
  doc.text(titleLines, 20, 20);
  
  // Body text
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const textLines = doc.splitTextToSize(text, 170);
  
  let cursorY = 20 + (titleLines.length * 7) + 10;
  
  for (let i = 0; i < textLines.length; i++) {
    if (cursorY > 280) {
      doc.addPage();
      cursorY = 20;
    }
    doc.text(textLines[i], 20, cursorY);
    cursorY += 5;
  }
  
  return doc.output('blob');
}

export default function DrAnalyzer() {
  const [report, setReport] = useState('');
  const [subject, setSubject] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true);

  const reportRef = useRef('');
  reportRef.current = report;

  const subjectRef = useRef('');
  subjectRef.current = subject;

  // Perform PDF download
  const downloadReportAsPDF = () => {
    if (!reportRef.current) return;
    const docTitle = subjectRef.current || 'F.R.I.D.A.Y. Strategic Analysis Report';
    const blob = generatePDF(docTitle, reportRef.current);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${docTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_report.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadReportAsPDFRef = useRef(downloadReportAsPDF);
  downloadReportAsPDFRef.current = downloadReportAsPDF;

  // Expose global controller for terminal triggers and voice commands
  useEffect(() => {
    window.FRIDAY_ANALYZER = {
      showReport: (text, title) => {
        setIsAnalyzing(true);
        // Auto-maximize analyzer terminal when new report starts
        window.dispatchEvent(new CustomEvent('friday-hud-maximize', { detail: { name: 'analyzer' } }));
        setTimeout(() => {
          setReport(text);
          setSubject(title);
          setIsAnalyzing(false);
        }, 800); // add simulated radar computation delay
      },
      downloadReport: () => {
        if (reportRef.current) {
          downloadReportAsPDFRef.current();
          return true;
        }
        return false;
      },
      clear: () => {
        setReport('');
        setSubject('');
        setIsAnalyzing(false);
      }
    };

    const handleMaximize = (e) => {
      if (e.detail.name === 'analyzer') {
        setIsMinimized(false);
      }
    };
    const handleMinimize = (e) => {
      if (e.detail.name === 'analyzer') {
        setIsMinimized(true);
      }
    };

    window.addEventListener('friday-hud-maximize', handleMaximize);
    window.addEventListener('friday-hud-minimize', handleMinimize);

    return () => {
      delete window.FRIDAY_ANALYZER;
      window.removeEventListener('friday-hud-maximize', handleMaximize);
      window.removeEventListener('friday-hud-minimize', handleMinimize);
    };
  }, []);

  const toggleMinimize = () => {
    if (isMinimized) {
      setIsMinimized(false);
      // Auto-minimize search when maximizing analyzer
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'search' } }));
    } else {
      setIsMinimized(true);
    }
  };

  return (
    <div className={`dr-analyzer-terminal ${isAnalyzing ? 'active-analysis-glow' : ''} ${isMinimized ? 'minimized' : ''}`}>
      {/* High-tech HUD Brackets */}
      <div className="analyzer-bracket dr-t-l" />
      <div className="analyzer-bracket dr-t-r" />
      <div className="analyzer-bracket dr-b-l" />
      <div className="analyzer-bracket dr-b-r" />

      {/* Header Panel */}
      <div className="analyzer-header" onClick={toggleMinimize} style={{ cursor: 'pointer' }}>
        <div className="analyzer-indicator">
          <span className={`analyzer-dot ${isAnalyzing ? 'analyzing' : ''}`} />
          <span className="analyzer-label">DR. ANALYZER // COGNITIVE SCANNER</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="analyzer-sec-label">COGNITION_v2.0</div>
          <button className="hud-toggle-btn" style={{ background: 'transparent', border: 'none', color: '#00ffbb', cursor: 'pointer', fontFamily: 'Orbitron', fontSize: '9px', outline: 'none' }}>
            {isMinimized ? '[ + ]' : '[ ─ ]'}
          </button>
        </div>
      </div>

      {/* Diagnostic / Report Viewport */}
      <div className="analyzer-body" style={{ display: isMinimized ? 'none' : 'flex' }}>
        {isAnalyzing ? (
          <div className="analyzer-radar-container">
            <div className="radar-circle-outer">
              <div className="radar-sweep-line" />
              <div className="radar-circle-mid">
                <div className="radar-circle-inner" />
              </div>
            </div>
            <div className="radar-text">RUNNING COGNITIVE RAG ANALYSER...</div>
          </div>
        ) : report ? (
          <div className="analyzer-report-container">
            <div className="analyzer-report-title">{subject}</div>
            <div className="analyzer-report-text">{report}</div>
            <button 
              className="analyzer-download-btn"
              onClick={downloadReportAsPDF}
            >
              [ DOWNLOAD PDF REPORT ]
            </button>
          </div>
        ) : (
          <div className="analyzer-radar-container">
            <div className="radar-circle-outer">
              <div className="radar-sweep-line" />
              <div className="radar-circle-mid">
                <div className="radar-circle-inner" />
              </div>
            </div>
            <div className="radar-text">RADAR SCANNER STANDBY // NO COGNITIVE ANOMALIES</div>
            
            {/* Holographic Stats panel */}
            <div className="radar-status-panel">
              <span className="radar-stat-item">SCAN_RATE: 4.8 GHZ</span>
              <span className="radar-stat-item">THREAT_INDEX: 0.00</span>
              <span className="radar-stat-item">MEMORY_LOAD: 12%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
