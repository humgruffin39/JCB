import { useId, useState } from 'react';

export function AbilitySlider({
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
    <div className="ability-slider">
      <div className="ability-slider__heading">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} aria-live="off">
          {String(value)}
        </output>
      </div>
      <input
        id={id}
        name={name}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => setValue(event.currentTarget.valueAsNumber)}
      />
    </div>
  );
}
