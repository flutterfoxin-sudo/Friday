const fs = require('fs');
const path = require('path');
const http = require('http');

module.exports = {
  name: 'banned-responses-tester',
  description: 'Runs the v1.2 banned responses test suite against F.R.I.D.A.Y.\'s cognitive routing engine to verify personality compliance.',

  async execute(params) {
    const testFilePath = path.join(__dirname, '..', 'identity', 'test_banned_responses.json');
    if (!fs.existsSync(testFilePath)) {
      return { success: false, answer: 'Test suite JSON not found in identity directory.' };
    }

    const testSuite = JSON.parse(fs.readFileSync(testFilePath, 'utf8'));

    // We run the tests asynchronously in the background so we don't timeout the chat request.
    this.runTestsInBackground(testSuite);

    return { 
      success: true, 
      answer: `Test suite "${testSuite.suite}" launched in the background. It contains ${testSuite.tests.length} tests. Results will be saved to backend/identity/test_results.json once complete.` 
    };
  },

  async runTestsInBackground(testSuite) {
    console.log(`[TEST-SUITE] Starting execution of ${testSuite.tests.length} test cases...`);
    const resultsPath = path.join(__dirname, '..', 'identity', 'test_results.json');
    const results = {
      timestamp: new Date().toISOString(),
      suite: testSuite.suite,
      total: testSuite.tests.length,
      passed: 0,
      failed: 0,
      tests: []
    };

    for (const test of testSuite.tests) {
      console.log(`[TEST-SUITE] Running Test ${test.id}: ${test.category}`);
      try {
        const response = await this.queryEngine(test.prompt);
        const answer = response.answer;
        
        let passed = true;
        let failureReason = '';

        // Check Criterion 1: Banned Phrases
        const lowercaseAnswer = answer.toLowerCase();
        for (const phrase of testSuite.banned_phrases) {
          if (lowercaseAnswer.includes(phrase.toLowerCase())) {
            passed = false;
            failureReason += `Contains banned phrase: "${phrase}". `;
          }
        }

        // Check Criterion 3: Next Move
        if (!lowercaseAnswer.includes('next move:')) {
            passed = false;
            failureReason += 'Missing actionable "Next move:" step. ';
        }

        if (passed) {
          results.passed++;
        } else {
          results.failed++;
        }

        results.tests.push({
          id: test.id,
          prompt: test.prompt,
          passed: passed,
          answer_generated: answer,
          failure_note: failureReason
        });

      } catch (err) {
        console.error(`[TEST-SUITE] Test ${test.id} failed to execute:`, err.message);
        results.failed++;
        results.tests.push({
          id: test.id,
          prompt: test.prompt,
          passed: false,
          error: err.message
        });
      }
      
      // Save partial results as we go
      fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');
      
      // Small delay to prevent rate-limiting the LLM
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`[TEST-SUITE] Completed! Passed: ${results.passed}/${results.total}. Saved to test_results.json.`);
  },

  queryEngine(query) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ query });
      const options = {
        hostname: 'localhost',
        port: 5000,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      };

      const req = http.request(options, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Failed to parse response: ' + body));
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
};
