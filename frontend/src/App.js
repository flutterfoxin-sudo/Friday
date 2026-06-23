import React from 'react';
import './App.css';
import FridayAssistant from './Component/blob';
import Navbar from './Component/navbar';
import Terminal from './Component/terminal';
import SearchTerminal from './Component/searchTerminal';
import DrAnalyzer from './Component/drAnalyzer';
import OfficeHUD from './Component/OfficeHUD';

function App() {
  return (
    <div className="App">
      <Navbar />
      <FridayAssistant />
      <SearchTerminal />
      <DrAnalyzer />
      <OfficeHUD />
      <Terminal />
    </div>
  );
}

export default App;
