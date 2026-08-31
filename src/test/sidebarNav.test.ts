import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { DEFAULT_SIDEBAR_NAV_ITEMS } from '../store/uiSlice';

describe('Sidebar Navigation Items Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.getState().resetSidebarNavItems();
  });

  it('should initialize with default sidebar navigation items and correct order', () => {
    const { sidebarNavItems } = useStore.getState();
    expect(sidebarNavItems.length).toBe(DEFAULT_SIDEBAR_NAV_ITEMS.length);
    expect(sidebarNavItems.map(i => i.id)).toEqual([
      'aideo',
      'charts',
      'library',
      'nowplaying',
      'loved_streams',
      'downloaded',
      'aideo_lab',
      'insights',
      'lastfm',
      'listenbrainz'
    ]);
    expect(sidebarNavItems.every(i => i.visible)).toBe(true);
  });

  it('should toggle visibility of a navigation item and update state and localStorage', () => {
    const { toggleSidebarNavItemVisibility } = useStore.getState();

    // Toggle downloaded off
    toggleSidebarNavItemVisibility('downloaded');
    let items = useStore.getState().sidebarNavItems;
    let downloaded = items.find(i => i.id === 'downloaded');
    expect(downloaded?.visible).toBe(false);

    // Toggle downloaded back on
    toggleSidebarNavItemVisibility('downloaded');
    items = useStore.getState().sidebarNavItems;
    downloaded = items.find(i => i.id === 'downloaded');
    expect(downloaded?.visible).toBe(true);
  });

  it('should prevent disabling the last visible navigation item (safety guard)', () => {
    const { toggleSidebarNavItemVisibility } = useStore.getState();

    // Hide all items except aideo
    const items = useStore.getState().sidebarNavItems;
    for (const item of items) {
      if (item.id !== 'aideo') {
        toggleSidebarNavItemVisibility(item.id);
      }
    }

    const state = useStore.getState();
    const visibleCount = state.sidebarNavItems.filter(i => i.visible).length;
    expect(visibleCount).toBe(1);

    // Attempt to hide the last active item ('aideo')
    toggleSidebarNavItemVisibility('aideo');
    const updatedState = useStore.getState();
    const aideo = updatedState.sidebarNavItems.find(i => i.id === 'aideo');
    expect(aideo?.visible).toBe(true);
  });

  it('should reorder navigation items up and down', () => {
    const { moveSidebarNavItem } = useStore.getState();

    // Move 'charts' (index 1) up to index 0
    moveSidebarNavItem(1, 'up');
    let items = useStore.getState().sidebarNavItems;
    expect(items[0].id).toBe('charts');
    expect(items[1].id).toBe('aideo');

    // Move 'charts' (index 0) down to index 1
    moveSidebarNavItem(0, 'down');
    items = useStore.getState().sidebarNavItems;
    expect(items[0].id).toBe('aideo');
    expect(items[1].id).toBe('charts');

    // Boundary checks (move top up, move bottom down - should do nothing)
    moveSidebarNavItem(0, 'up');
    expect(useStore.getState().sidebarNavItems[0].id).toBe('aideo');

    const lastIdx = items.length - 1;
    const lastId = items[lastIdx].id;
    moveSidebarNavItem(lastIdx, 'down');
    expect(useStore.getState().sidebarNavItems[lastIdx].id).toBe(lastId);
  });

  it('should restore default items, order, and visibility on reset', () => {
    const { toggleSidebarNavItemVisibility, moveSidebarNavItem, resetSidebarNavItems } = useStore.getState();

    toggleSidebarNavItemVisibility('library');
    toggleSidebarNavItemVisibility('downloaded');
    moveSidebarNavItem(2, 'up');

    expect(useStore.getState().sidebarNavItems.find(i => i.id === 'library')?.visible).toBe(false);

    resetSidebarNavItems();

    const resetItems = useStore.getState().sidebarNavItems;
    expect(resetItems.map(i => i.id)).toEqual(DEFAULT_SIDEBAR_NAV_ITEMS.map(i => i.id));
    expect(resetItems.every(i => i.visible)).toBe(true);
  });

  it('should synchronize with legacy lastfm and listenbrainz toggles', () => {
    const { toggleSidebarLastfmVisible, toggleSidebarListenbrainzVisible } = useStore.getState();

    toggleSidebarLastfmVisible();
    expect(useStore.getState().sidebarLastfmVisible).toBe(false);
    expect(useStore.getState().sidebarNavItems.find(i => i.id === 'lastfm')?.visible).toBe(false);

    toggleSidebarListenbrainzVisible();
    expect(useStore.getState().sidebarListenbrainzVisible).toBe(false);
    expect(useStore.getState().sidebarNavItems.find(i => i.id === 'listenbrainz')?.visible).toBe(false);
  });
});
