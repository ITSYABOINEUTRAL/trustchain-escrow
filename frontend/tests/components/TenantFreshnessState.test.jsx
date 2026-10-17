import { fireEvent, render, screen } from '@testing-library/react';
import TenantFreshnessState from '../../components/tenant/TenantFreshnessState';

test.each([
  ['loading', 'Loading tenant configuration…'],
  ['empty', 'No tenant configuration is available.'],
])('renders the %s state', (state, text) => {
  render(<TenantFreshnessState state={state} />);
  expect(screen.getByText(text)).toBeInTheDocument();
});

test('renders a recoverable failure state', () => {
  const retry = jest.fn();
  render(<TenantFreshnessState state="error" onRetry={retry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalled();
});
