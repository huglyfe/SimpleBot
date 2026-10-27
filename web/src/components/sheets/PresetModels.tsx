import { useQueries, useQuery } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import { REASONING_LEVELS, type Preset } from '@simplebot/shared';
import { getSettings, getProviderModels } from '../../api.js';
import { Field } from '../primitives/Field.js';
import { SearchPicker } from '../primitives/SearchPicker.js';
import { Section } from './Section.js';

/** Model discovery and effort changes edit the owning preset draft together. */
export function PresetModels({
  preset,
  change,
}: {
  preset: Preset;
  change: Dispatch<SetStateAction<Preset>>;
}) {
  const mainModel = preset.mainModel;
  const usesMainForSummary = preset.useMainModelForSummary;
  const summaryModel = usesMainForSummary ? mainModel : preset.summaryModel;
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const providers = Object.keys(settings.data?.value.providers ?? {});
  const catalogs = useQueries({
    queries: providers.map((provider) => ({
      queryKey: ['provider-models', provider],
      queryFn: () => getProviderModels(provider),
    })),
  });
  const models = providers.flatMap((provider, index) =>
    (catalogs[index]?.data?.models ?? []).map((model) => ({
      ...model,
      provider,
    })),
  );
  const catalogError = [
    settings.error?.message,
    ...providers.map((provider, index) => {
      const catalog = catalogs[index];
      const error = catalog?.error?.message ?? catalog?.data?.error;
      return error ? `${provider}: ${error}` : null;
    }),
  ]
    .filter(Boolean)
    .join(' · ');
  const loading =
    settings.isPending || catalogs.some((catalog) => catalog.isPending);
  const modelOptions = models.map((model) => ({
    value: JSON.stringify([model.provider, model.id]),
    label: model.name,
    detail: `${model.provider} · ${model.id} · ${String(Math.round(model.contextWindow / 1000))}k context${model.reasoning ? ' · reasoning' : ''}${model.images ? ' · images' : ''}`,
  }));

  function changeModels(
    selection: Partial<
      Pick<Preset, 'mainModel' | 'summaryModel' | 'useMainModelForSummary'>
    >,
  ): void {
    const sameModel = (left: Preset['mainModel'], right: Preset['mainModel']) =>
      left.provider === right.provider && left.model === right.model;
    const lowestEffort = (reference: Preset['mainModel']) => {
      const supported = models.find(
        (model) =>
          model.provider === reference.provider && model.id === reference.model,
      )?.reasoningLevels;
      // Custom IDs have no reported levels; keep the authored default explicit.
      return (
        REASONING_LEVELS.find((level) => supported?.includes(level)) ?? 'off'
      );
    };
    change((current) => {
      const main = selection.mainModel ?? current.mainModel;
      const separate = selection.summaryModel ?? current.summaryModel;
      const reuse =
        selection.useMainModelForSummary ?? current.useMainModelForSummary;
      const summarySelection = reuse
        ? { useMainModelForSummary: true as const, summaryModel: separate }
        : {
            useMainModelForSummary: false as const,
            summaryModel: separate ?? main,
          };
      const next = { ...current, mainModel: main, ...summarySelection };
      const beforeSummary = current.useMainModelForSummary
        ? current.mainModel
        : current.summaryModel;
      const afterSummary = next.useMainModelForSummary
        ? next.mainModel
        : next.summaryModel;
      return {
        ...next,
        mainEffort: sameModel(current.mainModel, next.mainModel)
          ? current.mainEffort
          : lowestEffort(next.mainModel),
        summaryEffort: sameModel(beforeSummary, afterSummary)
          ? current.summaryEffort
          : lowestEffort(afterSummary),
      };
    });
  }

  return (
    <>
      {catalogError ? (
        <p className="ui-hint is-error" role="alert">
          {catalogError}
        </p>
      ) : null}
      {(['main', 'summary'] as const).map((id) => {
        const label = id === 'main' ? 'Main' : 'Summary';
        const model = id === 'main' ? mainModel : summaryModel;
        const effort = preset[`${id}Effort`];
        const reported = models.find(
          (entry) =>
            entry.provider === model.provider && entry.id === model.model,
        );
        const supported = reported?.reasoningLevels ?? REASONING_LEVELS;
        const levels = REASONING_LEVELS.filter(
          (level) => level === effort || supported.includes(level),
        );
        return (
          <Section title={`${label} Model`} key={id}>
            {id === 'summary' ? (
              <Field
                label="Use main model for summaries"
                htmlFor="summary-model-reuse"
              >
                <input
                  id="summary-model-reuse"
                  className="ui-switch"
                  type="checkbox"
                  checked={usesMainForSummary}
                  disabled={loading}
                  onChange={(event) => {
                    changeModels({
                      useMainModelForSummary: event.target.checked,
                    });
                  }}
                />
              </Field>
            ) : null}
            {id === 'main' || !usesMainForSummary ? (
              <Field
                label={`${label} model`}
                hideLabel
                htmlFor={`${id}-model`}
                hint={model.provider}
              >
                <SearchPicker
                  id={`${id}-model`}
                  label={`${label} model`}
                  disabled={loading}
                  value={JSON.stringify([model.provider, model.model])}
                  fallbackLabel={`${model.model} · ${model.provider}`}
                  options={modelOptions}
                  emptyMessage={
                    loading
                      ? 'Loading models…'
                      : 'No models found. Check the provider configuration in Providers and keys.'
                  }
                  onChange={(value) => {
                    const [provider, model] = JSON.parse(value) as [
                      string,
                      string,
                    ];
                    changeModels({ [`${id}Model`]: { provider, model } });
                  }}
                  customOptions={(query) =>
                    providers
                      .filter(
                        (provider) =>
                          !models.some(
                            (entry) =>
                              entry.provider === provider && entry.id === query,
                          ),
                      )
                      .map((provider) => ({
                        value: JSON.stringify([provider, query]),
                        label: `Use “${query}”`,
                        detail: `${provider} · Custom model ID`,
                      }))
                  }
                />
              </Field>
            ) : null}
            <Field label="Reasoning effort" htmlFor={`${id}-effort`}>
              <select
                id={`${id}-effort`}
                aria-label={`${label} reasoning effort`}
                value={effort}
                onChange={(event) =>
                  change((current) => ({
                    ...current,
                    [`${id}Effort`]: event.target.value,
                  }))
                }
              >
                {levels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </Field>
          </Section>
        );
      })}
    </>
  );
}
