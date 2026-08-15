import { describe, expect, it, vi } from 'vitest';
import { submitHorseAdminForm } from './horse-admin-form.js';

describe('submitHorseAdminForm', () => {
  it('keeps the submitted form across the async request and completes onSaved', async () => {
    const formData = new FormData();
    for (const [name, value] of Object.entries({
      name: 'ジョサンブラック',
      status: 'active',
      runningStyle: 'closer',
      coatColor: 'black',
      speed: '64',
      start: '66',
      acceleration: '65',
      stamina: '64',
      lateKick: '60',
      conditionStability: '20',
      distancePreference: '10',
      surfacePreference: '0',
    })) {
      formData.set(name, value);
    }

    const reset = vi.fn();
    const formElement = { reset } as unknown as HTMLFormElement;
    let currentTargetReads = 0;
    const event = {
      get currentTarget(): HTMLFormElement {
        currentTargetReads += 1;
        if (currentTargetReads > 1) {
          throw new Error('currentTarget was read after the async boundary');
        }
        return formElement;
      },
    };
    const request = vi.fn(async (_path: string, _init?: RequestInit): Promise<unknown> => {
      void _path;
      void _init;
      await Promise.resolve();
      return undefined;
    });
    const onSaved = vi.fn(async () => undefined);

    await submitHorseAdminForm(event, {
      onSaved,
      request,
      readForm: () => formData,
    });

    expect(currentTargetReads).toBe(1);
    expect(request).toHaveBeenCalledOnce();
    const requestCall = request.mock.calls[0];
    expect(requestCall).toBeDefined();
    expect(requestCall?.[0]).toBe('/api/v1/admin/horses');
    expect(requestCall?.[1]?.method).toBe('POST');
    const requestBody = requestCall?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') throw new Error('request body is not a string');
    const parsedBody: unknown = JSON.parse(requestBody);
    expect(parsedBody).toMatchObject({
      name: 'ジョサンブラック',
      coatColor: 'black',
      lateKick: 60,
      distancePreference: 10,
    });
    expect(reset).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledWith('馬を登録しました。');
  });
});
