import { AnimatePresence } from 'framer-motion';
import { TheaterLayoutProps } from './types';
import { TheaterModeDesign } from '../../store/types';
import { StageLayout } from './StageLayout';
import { ZenLayout } from './ZenLayout';
import { StudioDeckLayout } from './StudioDeckLayout';
import { VinylTurntableLayout } from './VinylTurntableLayout';
import { EditorialPosterLayout } from './EditorialPosterLayout';
import { PureScopeLayout } from './PureScopeLayout';

export interface TheaterLayoutSwitchProps extends TheaterLayoutProps {
  design: TheaterModeDesign;
}

export function TheaterLayoutSwitch(props: TheaterLayoutSwitchProps) {
  const { design } = props;

  return (
    <AnimatePresence mode="wait">
      {(() => {
        switch (design) {
          case 'zen':
            return <ZenLayout key="zen" {...props} />;
          case 'studio':
            return <StudioDeckLayout key="studio" {...props} />;
          case 'vinyl':
            return <VinylTurntableLayout key="vinyl" {...props} />;
          case 'poster':
            return <EditorialPosterLayout key="poster" {...props} />;
          case 'scope':
            return <PureScopeLayout key="scope" {...props} />;
          case 'stage':
          default:
            return <StageLayout key="stage" {...props} />;
        }
      })()}
    </AnimatePresence>
  );
}
