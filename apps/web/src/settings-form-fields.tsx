import type { GameSettings } from '@jcb/config';

export function SettingsFormFields({ settings }: { readonly settings: GameSettings }) {
  return (
    <>
      <fieldset>
        <legend>標準スケジュール（JST）</legend>
        <div className="form-row">
          <TimeField
            name="missingRaceWarningTime"
            label="未作成警告"
            value={settings.missingRaceWarningTime}
          />
          <TimeField
            name="recommendedLockTime"
            label="確定推奨"
            value={settings.recommendedLockTime}
          />
          <TimeField name="viewerOpenTime" label="観戦開始" value={settings.viewerOpenTime} />
          <TimeField name="bettingCloseTime" label="馬券締切" value={settings.bettingCloseTime} />
          <TimeField name="startTime" label="発走" value={settings.startTime} />
        </div>
      </fieldset>

      <fieldset>
        <legend>調子抽選（合計100%）</legend>
        <div className="form-row">
          {CONDITION_FIELDS.map(([name, label]) => (
            <label key={name}>
              {label}
              <input
                name={`condition.${name}`}
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={settings.conditionProbabilities[name] * 100}
                required
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>更新・運用</legend>
        <div className="form-row">
          <NumberField
            name="discordOddsUpdateMilliseconds"
            label="Discordのオッズ更新間隔（秒）"
            value={settings.discordOddsUpdateMilliseconds / 1_000}
            min={10}
            max={120}
          />
          <NumberField
            name="webOddsPollMilliseconds"
            label="Webのオッズ更新間隔（秒）"
            value={settings.webOddsPollMilliseconds / 1_000}
            min={5}
            max={60}
          />
          <NumberField
            name="backupRetentionDays"
            label="バックアップ保持（日・次回再起動時）"
            value={settings.backupRetentionDays}
            min={1}
            max={90}
          />
          <NumberField
            name="visualEffectStrength"
            label="演出強度"
            value={settings.visualEffectStrength}
            min={0}
            max={1}
            step={0.1}
          />
          <NumberField
            name="soundVolume"
            label="音量初期値"
            value={settings.soundVolume}
            min={0}
            max={1}
            step={0.1}
          />
          <NumberField
            name="raceBetLimits.regular"
            label="通常レース購入上限"
            value={settings.raceBetLimits.regular}
            min={100}
            max={1_000_000}
          />
          <NumberField
            name="raceBetLimits.midweek"
            label="平日レース購入上限"
            value={settings.raceBetLimits.midweek}
            min={100}
            max={1_000_000}
          />
          <NumberField
            name="raceBetLimits.saturday_night"
            label="土曜夜購入上限"
            value={settings.raceBetLimits.saturday_night}
            min={100}
            max={1_000_000}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend>初期流動性の範囲</legend>
        <div className="form-row">
          <NumberField
            name="seed.regular.winMinimum"
            label="通常・単勝 最小"
            value={settings.seedLiquidityClamp.regular.winMinimum}
            min={0}
            max={1_000_000}
          />
          <NumberField
            name="seed.regular.winMaximum"
            label="通常・単勝 最大"
            value={settings.seedLiquidityClamp.regular.winMaximum}
            min={0}
            max={1_000_000}
          />
          <NumberField
            name="seed.regular.trifectaMinimum"
            label="通常・三連単 最小"
            value={settings.seedLiquidityClamp.regular.trifectaMinimum}
            min={0}
            max={1_000_000}
          />
          <NumberField
            name="seed.regular.trifectaMaximum"
            label="通常・三連単 最大"
            value={settings.seedLiquidityClamp.regular.trifectaMaximum}
            min={0}
            max={1_000_000}
          />
          <NumberField
            name="seed.special.winMinimum"
            label="特別・単勝 最小"
            value={settings.seedLiquidityClamp.special.winMinimum}
            min={0}
            max={1_000_000}
          />
          <NumberField
            name="seed.special.winMaximum"
            label="特別・単勝 最大"
            value={settings.seedLiquidityClamp.special.winMaximum}
            min={0}
            max={1_000_000}
          />
          <NumberField
            name="seed.special.trifectaMinimum"
            label="特別・三連単 最小"
            value={settings.seedLiquidityClamp.special.trifectaMinimum}
            min={0}
            max={1_000_000}
          />
          <NumberField
            name="seed.special.trifectaMaximum"
            label="特別・三連単 最大"
            value={settings.seedLiquidityClamp.special.trifectaMaximum}
            min={0}
            max={1_000_000}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend>シミュレーション設定</legend>
        <div className="form-row">
          <NumberField
            name="simulationNoiseStandardDeviation"
            label="揺らぎ標準偏差"
            value={settings.simulationNoiseStandardDeviation}
            min={0}
            max={0.1}
            step={0.001}
          />
          <NumberField
            name="fatigueMaximum"
            label="最大疲労補正"
            value={settings.fatigueMaximum}
            min={0}
            max={0.3}
            step={0.01}
          />
        </div>
      </fieldset>
    </>
  );
}

const CONDITION_FIELDS = [
  ['terrible', '絶不調'],
  ['poor', '不調'],
  ['normal', '普通'],
  ['good', '好調'],
  ['excellent', '絶好調'],
] as const;

function TimeField(input: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <label>
      {input.label}
      <input name={input.name} type="time" step={1} defaultValue={input.value} required />
    </label>
  );
}

function NumberField(input: {
  readonly name: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
}) {
  return (
    <label>
      {input.label}
      <input
        name={input.name}
        type="number"
        min={input.min}
        max={input.max}
        step={input.step ?? 1}
        defaultValue={input.value}
        required
      />
    </label>
  );
}
