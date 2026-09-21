/**
 * Every icon on the admin screens comes from one set, aliased here so call
 * sites read by intent rather than by the set's naming.
 *
 * Each icon wraps its paths in a `<mask>` whose `id` is fixed per icon name,
 * not per render. Two instances of the same icon on one page collide on that
 * id, and the loser renders as a solid square instead of its shape.
 * `mode="raw"` skips the mask, so every icon here is forced into that mode.
 */
import type { ComponentType } from 'react';
import {
  type CentralIconBaseProps as IconProps,
  IconCalendar1,
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconCrossMedium,
  IconSword,
  IconDice5,
  IconExclamationCircle,
  IconEyeOpen,
  IconLock,
  IconMinusMedium,
  IconPencil,
  IconPlay,
  IconPlusMedium,
  IconRotate,
  IconStopCircle,
  IconUnlocked,
  IconWarningSign,
} from '@central-icons-react/round-filled-radius-3-stroke-2';

export type { IconProps };
export type Icon = ComponentType<IconProps>;

const raw = (Source: Icon): Icon => {
  const Wrapped = (properties: IconProps) => <Source mode="raw" {...properties} />;
  Wrapped.displayName = `Raw(${Source.displayName ?? 'Icon'})`;
  return Wrapped;
};

/** Actions, named for what they do rather than what they draw. */
export const AddIcon = raw(IconPlusMedium);
export const EditIcon = raw(IconPencil);
export const LockIcon = raw(IconLock);
export const UnlockIcon = raw(IconUnlocked);
export const RetryIcon = raw(IconRotate);
export const AdvanceIcon = raw(IconPlay);
export const RevealIcon = raw(IconEyeOpen);
export const CancelIcon = raw(IconStopCircle);
export const CloseIcon = raw(IconCrossMedium);
export const RemoveIcon = raw(IconMinusMedium);
export const ShuffleIcon = raw(IconDice5);
export const RetireIcon = raw(IconSword);
export const CalendarIcon = raw(IconCalendar1);
export const ChevronLeftIcon = raw(IconChevronLeftMedium);
export const ChevronRightIcon = raw(IconChevronRightMedium);

export const ErrorIcon = raw(IconExclamationCircle);
export const WarningIcon = raw(IconWarningSign);
