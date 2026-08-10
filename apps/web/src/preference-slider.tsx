import { useId, useState } from 'react';

export function PreferenceSlider({
  name,
  label,
  initialValue,
}: {
  readonly name: string;
  readonly label: string;
  readonly initialValue: number;
}) {
  const id = useId();
  const [value, setValue] = useState(initialValue);

  return (
    <div className="preference-slider">
      <div className="preference-slider__heading">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} aria-live="off">
          {String(value)}
        </output>
      </div>
      <div className="preference-slider__control">
        <input
          id={id}
          name={name}
          type="range"
          min={-100}
          max={100}
          step={1}
          value={value}
          onChange={(event) => setValue(event.currentTarget.valueAsNumber)}
        />
      </div>
    </div>
  );
}
