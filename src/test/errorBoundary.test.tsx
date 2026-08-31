import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../components/ErrorBoundary';

function ProblemChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test Explosion in ProblemChild');
  }
  return <div>Healthy Child Content</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary name="TestView">
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Healthy Child Content')).toBeInTheDocument();
  });

  it('catches render error and displays fallback UI with error message', () => {
    // Suppress expected console.error during test
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary name="LibraryView">
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('LibraryView encountered an error')).toBeInTheDocument();
    expect(screen.getByText('Test Explosion in ProblemChild')).toBeInTheDocument();
    expect(screen.getByText('Reload View')).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it('recovers when Reload View is clicked and underlying issue is resolved', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function TestContainer() {
      const [hasError, setHasError] = useState(true);
      return (
        <div>
          <button onClick={() => setHasError(false)}>Fix Error</button>
          <ErrorBoundary onReset={() => setHasError(false)}>
            <ProblemChild shouldThrow={hasError} />
          </ErrorBoundary>
        </div>
      );
    }

    render(<TestContainer />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Click Reload View button on ErrorBoundary
    fireEvent.click(screen.getByText('Reload View'));

    expect(screen.getByText('Healthy Child Content')).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});
