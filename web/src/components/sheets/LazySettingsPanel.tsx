import {
  Component,
  Suspense,
  lazy,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Sheet } from '../primitives/Sheet.js';
import type { SettingsPanel as SettingsComponent } from './SettingsPanel.js';

const SettingsPanel = lazy(async () => ({
  default: (await import('./SettingsPanel.js')).SettingsPanel,
}));

/** A failed optional chunk must leave the conversation usable. */
class SettingsBoundary extends Component<
  {
    onClose: () => void;
    children: ReactNode;
    returnFocus: () => HTMLElement | null;
  },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? (
      <Sheet
        label="Settings unavailable"
        title="Settings unavailable"
        onClose={this.props.onClose}
        returnFocus={this.props.returnFocus}
      >
        <p role="alert">
          Settings could not load. Reload the app to try again.
        </p>
      </Sheet>
    ) : (
      this.props.children
    );
  }
}

export function LazySettingsPanel(
  props: ComponentProps<typeof SettingsComponent>,
) {
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const returnFocus = () => opener;
  return (
    <SettingsBoundary onClose={props.onClose} returnFocus={returnFocus}>
      <Suspense
        fallback={
          <Sheet
            label="Loading settings"
            title="Settings"
            placement="center"
            onClose={props.onClose}
            closeLabel="Cancel"
            returnFocus={returnFocus}
          >
            <p className="ui-empty" role="status">
              Loading settings…
            </p>
          </Sheet>
        }
      >
        <SettingsPanel {...props} returnFocus={returnFocus} />
      </Suspense>
    </SettingsBoundary>
  );
}
