import history from '../assets/history.svg';
import settings from '../assets/settings.svg';
import close from '../assets/close.svg';
import plus from '../assets/plus.svg';
import arrowUp from '../assets/arrow-up.svg';

const icons = { history, settings, close, plus, arrowUp } as const;

export function Icon({ name, size = 18 }: { name: keyof typeof icons; size?: number }) {
  return (
    <img
      src={icons[name]}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      className="panel-icon"
    />
  );
}
