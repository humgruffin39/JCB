import {
  LocateFixed,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { type CSSProperties } from 'react';
import type { RaceCameraMode } from './race-world.js';

export interface PlaybackControlsProps {
  readonly isPaused: boolean;
  readonly cameraMode: RaceCameraMode;
  readonly isFullscreen: boolean;
  readonly onPause: () => void;
  readonly onToggleCamera: () => void;
  readonly onToggleFullscreen: () => void;
}

export function PlaybackControls({
  isPaused,
  cameraMode,
  isFullscreen,
  onPause,
  onToggleCamera,
  onToggleFullscreen,
}: PlaybackControlsProps) {
  return (
    <div className="broadcast-controls">
      <button
        className="broadcast-icon-button broadcast-camera-button"
        type="button"
        aria-label={cameraMode === 'follow' ? '1位を追尾' : '放送カメラに戻す'}
        aria-pressed={cameraMode === 'horse'}
        title={cameraMode === 'follow' ? '1位を追尾' : '放送カメラに戻す'}
        onClick={onToggleCamera}
      >
        {cameraMode === 'follow' ? (
          <LocateFixed aria-hidden="true" />
        ) : (
          <Video aria-hidden="true" />
        )}
      </button>
      <button
        className="broadcast-icon-button"
        type="button"
        aria-label={isPaused ? '再生' : '一時停止'}
        title={isPaused ? '再生' : '一時停止'}
        onClick={onPause}
      >
        {isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
      </button>
      <button
        className="broadcast-icon-button broadcast-fullscreen-button"
        type="button"
        aria-label={isFullscreen ? '全画面を終了' : '全画面で見る'}
        aria-pressed={isFullscreen}
        title={isFullscreen ? '全画面を終了' : '全画面で見る'}
        onClick={onToggleFullscreen}
      >
        {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
      </button>
    </div>
  );
}

export interface SoundControlsProps {
  readonly isMuted: boolean;
  readonly volume: number;
  readonly onMute: () => void;
  readonly onVolume: (value: number) => void;
}

export function SoundControls({ isMuted, volume, onMute, onVolume }: SoundControlsProps) {
  const isSilent = isMuted || volume === 0;
  return (
    <>
      <button
        className="broadcast-icon-button"
        type="button"
        aria-label={isSilent ? '音声をオン' : '音声をオフ'}
        aria-pressed={!isSilent}
        title={isSilent ? '音声をオン' : '音声をオフ'}
        onClick={onMute}
      >
        {isSilent ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      </button>
      <VolumeSlider value={volume} onChange={onVolume} />
    </>
  );
}

export interface VolumeSliderProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
}

export function VolumeSlider({ value, onChange }: VolumeSliderProps) {
  const progress = `${String(Math.round(value * 100))}%`;

  return (
    <label className="volume-slider" style={{ '--volume-progress': progress } as CSSProperties}>
      <span className="sr-only">音量</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="volume-slider__visual" aria-hidden="true">
        <span className="volume-slider__track">
          <span className="volume-slider__fill" />
        </span>
        <span className="volume-slider__thumb" />
      </span>
    </label>
  );
}
