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
  const [draft, setDraft] = useState(String(initialValue));
  const parsedValue = Number(draft);
  const value = Number.isInteger(parsedValue) ? Math.max(0, Math.min(100, parsedValue)) : 0;

  function normalize(): void {
    setDraft(String(value));
  }

  return (
    <div className="ability-slider">
      {/* The field is the readout. A separate one beside the label said the
          same number twice and cost a row of the dialog for each ability. */}
      <div className="ability-slider__heading">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          name={name}
          type="number"
          min={0}
          max={100}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={normalize}
        />
      </div>
      <div className="ability-meter" aria-hidden="true">
        <span style={{ width: `${String(value)}%` }} />
      </div>
    </div>
  );
}
