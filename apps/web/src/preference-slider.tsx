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
  const [draft, setDraft] = useState(String(initialValue));
  const parsedValue = Number(draft);
  const value = Number.isInteger(parsedValue) ? Math.max(-100, Math.min(100, parsedValue)) : 0;

  function normalize(): void {
    setDraft(String(value));
  }

  return (
    <div className="preference-slider">
      {/* The field is the readout. A separate one beside the label said the
          same number twice and cost a row of the dialog for each ability. */}
      <div className="preference-slider__heading">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          name={name}
          type="number"
          min={-100}
          max={100}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={normalize}
        />
      </div>
      <div className="preference-meter" aria-hidden="true">
        <span style={{ left: `${String((value + 100) / 2)}%` }} />
      </div>
    </div>
  );
}
