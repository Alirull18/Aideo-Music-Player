import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LocalQRCode } from '../components/LocalQRCode';

describe('LocalQRCode', () => {
  it('renders a valid SVG with the specified dimensions', () => {
    const { container } = render(<LocalQRCode value="http://192.168.1.50:1420?pin=123456" size={60} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '60');
    expect(svg).toHaveAttribute('height', '60');
    expect(container.querySelectorAll('path, rect').length).toBeGreaterThan(0);
  });

  it('renders nothing when value is empty', () => {
    const { container } = render(<LocalQRCode value="" size={60} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
