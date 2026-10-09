import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './icons';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'aria-label' | 'children'> {
  icon: IconName;
  /** Tooltip and accessible name. Required: icon-only controls must always describe their action. */
  label: string;
  /** Toggle/selected state, exposed visually and through `aria-pressed`. */
  pressed?: boolean;
  /** Optional visible text next to the icon. */
  text?: string;
  variant?: 'default' | 'round' | 'toggle';
  size?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, pressed, text, variant = 'default', size, className, type = 'button', ...rest },
  ref
) {
  const classes = ['icon-button', `icon-button-${variant}`, pressed === true ? 'is-pressed' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      title={label}
      aria-label={label}
      {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      {...rest}
    >
      <Icon name={icon} {...(size !== undefined ? { size } : {})} />
      {text !== undefined && <span className="icon-button-text">{text}</span>}
    </button>
  );
});
