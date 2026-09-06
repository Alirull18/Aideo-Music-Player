import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

// Pure client-side QR Code SVG generator (offline, no external API calls)
export const LocalQRCode: React.FC<{ value: string; size?: number }> = ({ value, size = 70 }) => {
  if (!value) return null;

  return (
    <QRCodeSVG
      value={value}
      size={size}
      bgColor="#ffffff"
      fgColor="#000000"
      level="M"
      marginSize={1}
      style={{ borderRadius: 4, display: 'block' }}
    />
  );
};
