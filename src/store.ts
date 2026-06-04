import { create } from 'zustand';
import { PlayerState } from './store/types';
import { createUISlice } from './store/uiSlice';
import { createPlaybackSlice } from './store/playbackSlice';
import { createLibrarySlice } from './store/librarySlice';
import { createMetadataSlice } from './store/metadataSlice';
import { createLastfmSlice } from './store/lastfmSlice';
import { createListenbrainzSlice } from './store/listenbrainzSlice';
import { createCloudSlice } from './store/cloudSlice';
import { createAuthSlice } from './store/authSlice';

// Export types for convenience so other files can still import from './store'
export * from './store/types';

export const useStore = create<PlayerState>()((...a) => ({
  ...createUISlice(...a),
  ...createPlaybackSlice(...a),
  ...createLibrarySlice(...a),
  ...createMetadataSlice(...a),
  ...createLastfmSlice(...a),
  ...createListenbrainzSlice(...a),
  ...createCloudSlice(...a),
  ...createAuthSlice(...a),
}));

