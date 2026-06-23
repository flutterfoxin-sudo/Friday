import { render, screen } from '@testing-library/react';
import App from './App';

test('renders learn react link', () => {
  render(<App />);
  const searchLabel = screen.getByText(/CYBER SEARCH MATRIX/i);
  expect(searchLabel).toBeInTheDocument();
});
