import { AnimatePresence } from 'framer-motion';
import { TheaterLayoutProps } from './types';
import { TheaterModeDesign } from '../../store/types';
import { ZenLayout } from './ZenLayout';
import { StudioDeckLayout } from './StudioDeckLayout';

export interface TheaterLayoutSwitchProps extends TheaterLayoutProps {
  design: TheaterModeDesign;
}

export function TheaterLayoutSwitch(props: TheaterLayoutSwitchProps) {
  const { design } = props;

  return (
    <AnimatePresence mode="wait">
      {design === 'zen' ? (
        <ZenLayout key="zen" {...props} />
      ) : (
        <StudioDeckLayout key="studio" {...props} />
      )}
    </AnimatePresence>
  );
}
