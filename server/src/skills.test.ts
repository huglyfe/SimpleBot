import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { disposeTestFixture, createTestFixture } from './test-helper.js';
import { readSkill, writeSkill, deleteSkill } from './skills.js';
import { AuthoredFiles } from './authored.js';

test('Skill authoring preserves extra frontmatter and files; publication changes only on refresh', async (t) => {
  const { runtime, root } = await createTestFixture();
  t.after(() => disposeTestFixture({ runtime, root }));
  const value = {
    name: 'test-skill',
    description: 'Testing',
    instructions: 'Original instructions',
  };
  const write = await runtime.app.inject({
    method: 'PUT',
    url: '/api/skills/test-skill',
    payload: { value, expectedRevision: 'missing' },
  });
  assert.equal(write.statusCode, 200, write.body);
  assert.equal(
    runtime.capabilities.catalog.capabilities.some(
      (entry) => entry.kind === 'skill' && entry.name === value.name,
    ),
    false,
  );
  const refreshed = await runtime.app.inject({
    method: 'POST',
    url: '/api/capabilities/refresh',
  });
  assert.equal(refreshed.statusCode, 200);
  assert.equal(
    runtime.capabilities.catalog.capabilities.some(
      (entry) => entry.kind === 'skill' && entry.name === value.name,
    ),
    true,
  );
  const path = join(root, 'skills/test-skill/SKILL.md');
  await writeFile(
    path,
    '---\nname: test-skill\ndescription: Testing\nmetadata:\n  author: Example\n---\nOriginal instructions',
  );
  await writeFile(join(root, 'skills/test-skill/reference.txt'), 'Keep this');
  const before = readSkill(root, value.name);
  const revision = writeSkill(
    root,
    value.name,
    { ...value, instructions: 'New instructions' },
    before.revision,
  );
  assert.match(await readFile(path, 'utf8'), /author: Example/u);
  assert.throws(
    () => writeSkill(root, value.name, value, before.revision),
    /changed on disk/u,
  );
  assert.throws(
    () => deleteSkill(root, value.name, before.revision),
    /changed on disk/u,
  );
  deleteSkill(root, value.name, revision);
  assert.equal(
    await readFile(join(root, 'skills/test-skill/reference.txt'), 'utf8'),
    'Keep this',
  );
  assert.equal(
    runtime.capabilities.catalog.capabilities.some(
      (entry) => entry.kind === 'skill' && entry.name === value.name,
    ),
    true,
  );
  await runtime.app.inject({
    method: 'POST',
    url: '/api/capabilities/refresh',
  });
  assert.equal(
    runtime.capabilities.catalog.capabilities.some(
      (entry) => entry.kind === 'skill' && entry.name === value.name,
    ),
    false,
  );
});

test('Skill authoring refuses traversal, symlinks, duplicate creation, and mismatched names', async (t) => {
  const { runtime, root } = await createTestFixture();
  t.after(() => disposeTestFixture({ runtime, root }));
  const value = { name: 'local', description: 'Local', instructions: '' };
  writeSkill(root, 'local', value, 'missing');
  assert.throws(
    () => writeSkill(root, 'local', value, 'missing'),
    /changed on disk/u,
  );
  assert.throws(() => writeSkill(root, '../escape', value, 'missing'));
  assert.throws(
    () => writeSkill(root, 'different', value, 'missing'),
    /cannot change/u,
  );
  await mkdir(join(root, 'outside'));
  await symlink(join(root, 'outside'), join(root, 'skills/linked'));
  assert.throws(
    () => writeSkill(root, 'linked', { ...value, name: 'linked' }, 'missing'),
    /local directories/u,
  );
});

test('preset display rename preserves identity and deletion refuses every reference owner', async (t) => {
  const { runtime, root } = await createTestFixture();
  t.after(() => disposeTestFixture({ runtime, root }));
  const authored = new AuthoredFiles(root);
  const preset = await authored.readPresetDocument('default');
  await authored.writePresetDocument(
    'default',
    { ...preset.value, name: 'Renamed preset' },
    preset.revision,
  );
  assert.equal(
    (await authored.listPresets()).find((entry) => entry.slug === 'default')
      ?.name,
    'Renamed preset',
  );
  const spareRevision = await authored.writePresetDocument(
    'spare',
    preset.value,
    'missing',
  );
  const bot = await authored.createBot('Preset reference');
  const card = await authored.readBotDocument(bot.slug);
  await authored.writeBotDocument(
    bot.slug,
    {
      ...card.value,
      data: {
        ...card.value.data,
        extensions: { simplebot: { defaultPreset: 'spare' } },
      },
    },
    card.revision,
  );
  assert.throws(
    () => authored.deletePreset('spare', spareRevision),
    /used by bot/u,
  );
  const spareCard = await authored.readBotDocument(bot.slug);
  await authored.writeBotDocument(bot.slug, card.value, spareCard.revision);
  const session = await runtime.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { botSlug: bot.slug, presetSlug: 'spare' },
  });
  assert.equal(session.statusCode, 201, session.body);
  const refused = await runtime.app.inject({
    method: 'DELETE',
    url: '/api/presets/spare',
    payload: { expectedRevision: spareRevision },
  });
  assert.equal(refused.statusCode, 409);
  const unused = await authored.writePresetDocument(
    'unused',
    preset.value,
    'missing',
  );
  assert.throws(
    () => authored.deletePreset('unused', 'stale'),
    /changed on disk/u,
  );
  const removed = await runtime.app.inject({
    method: 'DELETE',
    url: '/api/presets/unused',
    payload: { expectedRevision: unused },
  });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(
    (await authored.listPresets()).some((entry) => entry.slug === 'unused'),
    false,
  );
});

test('Skill editing separates one frontmatter blank line and preserves the remaining body across saves', async (t) => {
  const { runtime, root } = await createTestFixture();
  t.after(() => disposeTestFixture({ runtime, root }));
  const directory = join(root, 'skills', 'spacing');
  await mkdir(directory, { recursive: true });
  for (const newline of ['\n', '\r\n']) {
    for (const separator of ['', newline, newline + newline]) {
      const body =
        '# Instructions' +
        newline +
        newline +
        '  Keep this indentation.  ' +
        newline;
      await writeFile(
        join(directory, 'SKILL.md'),
        [
          '---',
          'name: spacing',
          'description: A description',
          'metadata:',
          '  author: Example',
          '---',
          '',
        ].join(newline) +
          separator +
          body,
      );
      let document = readSkill(root, 'spacing');
      const expected = (separator === newline + newline ? newline : '') + body;
      assert.equal(document.value.instructions, expected);
      for (let index = 0; index < 3; index++) {
        writeSkill(
          root,
          'spacing',
          { ...document.value, description: 'A longer\ndescription' },
          document.revision,
        );
        document = readSkill(root, 'spacing');
        assert.equal(document.value.instructions, expected);
        assert.equal(document.value.description, 'A longer\ndescription');
        assert.match(document.source, /author: Example/u);
      }
    }
  }
});
