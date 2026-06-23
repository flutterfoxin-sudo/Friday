import React from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import Terminal from './terminal';

// Mock global variables
beforeAll(() => {
  window.FRIDAY_SEARCH = {
    start: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    playMedia: jest.fn(() => true),
    closeMedia: jest.fn(),
    getActiveEmbed: jest.fn(() => null),
    getSearchRedirectUrl: jest.fn(() => '')
  };
  window.FRIDAY = {
    setSearching: jest.fn(),
    setThinking: jest.fn(),
    setSpeaking: jest.fn(),
    setState: jest.fn()
  };
  window.FRIDAY_ANALYZER = {
    showReport: jest.fn(),
    downloadReport: jest.fn(() => true),
    clear: jest.fn()
  };
  window.open = jest.fn();

  // Mock SpeechSynthesis
  window.speechSynthesis = {
    speak: jest.fn(),
    cancel: jest.fn(),
    getVoices: jest.fn(() => [
      { name: 'Microsoft David Mobile', lang: 'en-US' }
    ])
  };
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
      this.lang = '';
      this.pitch = 1.0;
      this.rate = 1.0;
      this.voice = null;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  };
});

afterAll(() => {
  delete window.FRIDAY_SEARCH;
  delete window.FRIDAY;
  delete window.FRIDAY_ANALYZER;
  delete window.open;
  delete window.speechSynthesis;
  delete window.SpeechSynthesisUtterance;
});

describe('Terminal Component Voice Commands', () => {
  let mockFetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = jest.fn().mockImplementation((url, options) => {
      const urlStr = String(url);
      
      // Parse request body for queries
      let bodyObj = {};
      try {
        if (options && options.body) {
          bodyObj = JSON.parse(options.body);
        }
      } catch (e) {}

      if (urlStr.includes('/api/voice')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            success: true,
            settings: { current: 'female', models: ['male', 'female'] }
          })
        });
      }

      if (urlStr.includes('/api/assistant/briefing')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            success: true,
            briefing: "Mock briefing text for Vansh sir."
          })
        });
      }

      if (urlStr.includes('/api/chat')) {
        const query = (bodyObj.query || '').toLowerCase();
        let answer = "Standby response.";
        let searchExecuted = false;
        let searchResults = null;
        let searchMode = 'web';

        if (query.includes('react')) {
          answer = "React is a UI library.";
          searchExecuted = true;
          searchResults = [{ title: 'React', url: 'https://react.dev' }];
        } else if (query.includes('photosynthesis')) {
          answer = "A process of energy conversion.";
        } else if (query.includes('joke') || query.includes('greetings') || query.includes('hello')) {
          answer = "At your service, sir. How can I help you?";
        }

        return Promise.resolve({
          json: () => Promise.resolve({
            success: true,
            answer,
            searchExecuted,
            searchMode,
            searchResults,
            memory: { facts: ['user likes react'], interests: ['react'] }
          })
        });
      }

      if (urlStr.includes('/api/skills/execute/trading')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            success: true,
            result: {
              ticker: 'BTC',
              market: 'crypto',
              analysis: {
                lastPriceUSD: '60000',
                relativeStrengthIndexRSI: '55',
                suggestedAction: 'BUY',
                rationality: 'Strong momentum.'
              }
            }
          })
        });
      }

      if (urlStr.includes('/api/skills/execute/memory')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            success: true,
            message: "Memory cleared"
          })
        });
      }

      // Default fallback (e.g. search/scraper execution)
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          result: {
            source: 'scraper',
            data: [{ title: 'Wikipedia', url: 'https://wikipedia.org' }]
          }
        })
      });
    });
    global.fetch = mockFetch;
  });

  test('executes web search on "search for Wikipedia" voice command', async () => {
    render(<Terminal />);
    
    // Trigger mock voice search inside act()
    act(() => {
      window.mockSpeechResult("search for Wikipedia", true);
    });

    // Assert fetch was called with the web search payload (lowercased)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5000/api/skills/execute/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'wikipedia', mode: 'web' })
      })
    );
  });

  test('executes youtube search on "search youtube for cats" voice command', async () => {
    render(<Terminal />);
    
    // Trigger mock youtube search inside act()
    act(() => {
      window.mockSpeechResult("search youtube for cats", true);
    });

    // Assert fetch was called with youtube search payload
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5000/api/skills/execute/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'cats', mode: 'youtube' })
      })
    );
  });

  test('executes youtube search on suffix "cats on youtube" voice command', async () => {
    render(<Terminal />);
    
    act(() => {
      window.mockSpeechResult("search for cats on youtube", true);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5000/api/skills/execute/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'cats', mode: 'youtube' })
      })
    );
  });

  test('opens search result URL on "open result first" voice command', async () => {
    // Populate fake search results
    window.FRIDAY_SEARCH_RESULTS = [
      { title: 'Wikipedia', url: 'https://wikipedia.org' }
    ];

    render(<Terminal />);

    act(() => {
      window.mockSpeechResult("open result first", true);
    });

    expect(window.open).toHaveBeenCalledWith('https://wikipedia.org', '_blank');
  });

  test('plays video in HUD on "play first video" voice command', () => {
    render(<Terminal />);
    
    act(() => {
      window.mockSpeechResult("play first video", true);
    });

    expect(window.FRIDAY_SEARCH.playMedia).toHaveBeenCalledWith(1, 'video');
  });

  test('opens website in HUD on "open second website" voice command', () => {
    render(<Terminal />);
    
    act(() => {
      window.mockSpeechResult("open second website", true);
    });

    expect(window.FRIDAY_SEARCH.playMedia).toHaveBeenCalledWith(2, 'website');
  });

  test('closes inline media on "close video" voice command', () => {
    render(<Terminal />);
    
    act(() => {
      window.mockSpeechResult("close video", true);
    });

    expect(window.FRIDAY_SEARCH.closeMedia).toHaveBeenCalled();
  });

  test('redirects active playing media to browser on "redirect to browser" voice command', () => {
    window.FRIDAY_SEARCH.getActiveEmbed.mockReturnValueOnce({
      type: 'video',
      url: 'https://youtube.com/watch?v=123',
      title: 'Test Video',
      index: 1
    });

    render(<Terminal />);

    act(() => {
      window.mockSpeechResult("redirect to browser", true);
    });

    expect(window.open).toHaveBeenCalledWith('https://youtube.com/watch?v=123', '_blank');
  });

  test('redirects general search results to browser on "redirect to results" voice command when no media active', () => {
    window.FRIDAY_SEARCH.getActiveEmbed.mockReturnValueOnce(null);
    window.FRIDAY_SEARCH.getSearchRedirectUrl.mockReturnValueOnce('https://duckduckgo.com/?q=wikipedia');

    render(<Terminal />);

    act(() => {
      window.mockSpeechResult("redirect to search results", true);
    });

    expect(window.open).toHaveBeenCalledWith('https://duckduckgo.com/?q=wikipedia', '_blank');
  });

  test('executes chat query on general question "what is React js" voice command', async () => {
    window.FRIDAY_SUGGESTIONS = {
      show: jest.fn()
    };

    render(<Terminal />);

    await act(async () => {
      window.mockSpeechResult("what is React js", true);
    });

    // Check that api/chat was called with correct payload
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5000/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'what is react js' })
      })
    );

    // Verify Search Terminal got updated with RAG search results
    expect(window.FRIDAY_SEARCH.start).toHaveBeenCalledWith('what is react js');
    expect(window.FRIDAY_SEARCH.success).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [{ title: 'React', url: 'https://react.dev' }]
      })
    );

    // Verify Suggestion Terminal got updated
    expect(window.FRIDAY_SUGGESTIONS.show).toHaveBeenCalledWith(
      expect.stringContaining('ANALYSIS COMPLETE')
    );

    delete window.FRIDAY_SUGGESTIONS;
  });

  test('wakes up F.R.I.D.A.Y. when general question is asked via voice', async () => {
    render(<Terminal />);

    await act(async () => {
      window.mockSpeechResult("how does photosynthesis work", true);
    });

    expect(window.FRIDAY.setThinking).toHaveBeenCalledWith(true);
  });

  test('re-executes last search on "refresh search" voice command', async () => {
    render(<Terminal />);
    
    // First trigger a search to populate lastSearchRef
    await act(async () => {
      window.mockSpeechResult("search for Wikipedia", true);
    });

    jest.clearAllMocks();

    // Now trigger refresh
    act(() => {
      window.mockSpeechResult("refresh search", true);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5000/api/skills/execute/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'wikipedia', mode: 'web' })
      })
    );
  });

  test('calls memory clear endpoint on "/reset" console command', async () => {
    render(<Terminal />);
    const input = screen.getByRole('textbox');
    const form = screen.getByTestId('cmd-form');

    fireEvent.change(input, { target: { value: '/reset' } });
    fireEvent.submit(form);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5000/api/skills/execute/memory',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'clear' })
      })
    );
  });

  test('triggers speech synthesis when chat response is received', async () => {
    render(<Terminal />);

    act(() => {
      window.mockSpeechResult("tell me a joke", true);
    });

    await waitFor(() => {
      const calls = window.speechSynthesis.speak.mock.calls;
      const hasAnswer = calls.some(call => call[0].text.includes("At your service, sir. How can I help you?"));
      expect(hasAnswer).toBe(true);
    });

    const calls = window.speechSynthesis.speak.mock.calls;
    const utterance = calls[calls.length - 1][0];
    expect(utterance.pitch).toBe(1.08);
    expect(utterance.rate).toBe(1.0);
  });

  test('speaks greeting when wake word is detected', async () => {
    render(<Terminal />);

    act(() => {
      window.mockSpeechResult("friday", true);
    });

    await waitFor(() => {
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    const utterance = window.speechSynthesis.speak.mock.calls[0][0];
    const greetings = [
      "At your service, sir. How is your day going?",
      "Go ahead, sir. How is your day going?",
      "Online and ready, sir. How is your day going?"
    ];
    expect(greetings).toContain(utterance.text);
  });

  test('answers and introduces itself when asked to introduce yourself', async () => {
    render(<Terminal />);

    await act(async () => {
      window.mockSpeechResult("introduce yourself", true);
    });

    await waitFor(() => {
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    const calls = window.speechSynthesis.speak.mock.calls;
    const utterance = calls[calls.length - 1][0];
    expect(utterance.text).toContain("Female Repli Identity Development & Analytics Yield");
  });

  test('answers when asked how is your day going', async () => {
    render(<Terminal />);

    await act(async () => {
      window.mockSpeechResult("how is your day", true);
    });

    await waitFor(() => {
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    const calls = window.speechSynthesis.speak.mock.calls;
    const utterance = calls[calls.length - 1][0];
    expect(utterance.text).toContain("My systems are running at peak efficiency, sir");
  });

  test('calls window.FRIDAY_ANALYZER.showReport on trading skill execution', async () => {
    render(<Terminal />);

    await act(async () => {
      window.mockSpeechResult("analyse BTC on crypto", true);
    });

    expect(window.FRIDAY_ANALYZER.showReport).toHaveBeenCalledWith(
      expect.stringContaining('TRADING REPORT: Ticker BTC'),
      'TRADING ANALYSIS REPORT - BTC'
    );
  });

  test('calls window.FRIDAY_ANALYZER.downloadReport on download report voice command', async () => {
    render(<Terminal />);

    act(() => {
      window.mockSpeechResult("download report", true);
    });

    expect(window.FRIDAY_ANALYZER.downloadReport).toHaveBeenCalled();
  });

  test('requests and speaks personal daily briefing on voice command', async () => {
    render(<Terminal />);

    await act(async () => {
      window.mockSpeechResult("give me my briefing", true);
    });

    await waitFor(() => {
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });

    const calls = window.speechSynthesis.speak.mock.calls;
    const utterance = calls[calls.length - 1][0];
    expect(utterance.text).toContain("Mock briefing text for Vansh sir.");
  });
});
