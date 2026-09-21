import { describe, expect, it, vi } from 'vitest'

import { command_addRole, extractTrailingEmojis } from '../addRole'

describe('extractTrailingEmojis', () => {
  it('extracts single unicode emoji at the end', () => {
    expect(extractTrailingEmojis('Master 🏆')).toEqual(['🏆'])
  })

  it('extracts multiple unicode emojis at the end', () => {
    expect(extractTrailingEmojis('Legend 🥇 🥈 🥉')).toEqual(['🥇', '🥈', '🥉'])
  })

  it('extracts custom discord emojis', () => {
    expect(extractTrailingEmojis('Champion <:pika:123456>')).toEqual([
      'pika:123456',
    ])
  })

  it('extracts animated custom discord emojis', () => {
    expect(extractTrailingEmojis('VIP <a:fire:987654>')).toEqual([
      'fire:987654',
    ])
  })

  it('extracts mix of unicode and custom emojis at the end', () => {
    expect(extractTrailingEmojis('Ultimate 🎉 <:custom:111222> 🚀')).toEqual([
      '🎉',
      'custom:111222',
      '🚀',
    ])
  })

  it('returns empty array when there are no emojis at the end', () => {
    expect(extractTrailingEmojis('Server Admin')).toEqual([])
  })

  it('returns empty array when emoji is at the start or middle only', () => {
    expect(extractTrailingEmojis('⭐ Super Mod')).toEqual([])
    expect(extractTrailingEmojis('Super ⭐ Mod')).toEqual([])
  })
})

describe('command_addRole autocomplete', () => {
  const sampleRoles = [
    { id: '1', name: 'Member' },
    { id: '2', name: 'VIP 🌟' },
    { id: '3', name: 'Admin 👑' },
    { id: '4', name: '[Color] #FF0000' },
    { id: 'guild-123', name: '@everyone' },
  ]

  it('returns filtered role choices excluding @everyone and [Color] roles', async () => {
    const resAutocompleteMock = vi.fn((val: unknown) => val)
    const context = {
      interaction: {
        guild_id: 'guild-123',
      },
      env: {
        DISCORD_TEST_GUILD_ID: 'guild-123',
      },
      focused: {
        value: '',
      },
      resAutocomplete: resAutocompleteMock,
      rest: vi.fn(async () => ({
        ok: true,
        json: async () => sampleRoles,
      })),
    }

    await command_addRole.autocomplete(context as never)

    expect(resAutocompleteMock).toHaveBeenCalledWith({
      choices: [
        { name: 'Member', value: '1' },
        { name: 'VIP 🌟', value: '2' },
        { name: 'Admin 👑', value: '3' },
      ],
    })
  })

  it('filters choices by query', async () => {
    const resAutocompleteMock = vi.fn((val: unknown) => val)
    const context = {
      interaction: {
        guild_id: 'guild-123',
      },
      env: {
        DISCORD_TEST_GUILD_ID: 'guild-123',
      },
      focused: {
        value: 'vip',
      },
      resAutocomplete: resAutocompleteMock,
      rest: vi.fn(async () => ({
        ok: true,
        json: async () => sampleRoles,
      })),
    }

    await command_addRole.autocomplete(context as never)

    expect(resAutocompleteMock).toHaveBeenCalledWith({
      choices: [{ name: 'VIP 🌟', value: '2' }],
    })
  })
})

describe('command_addRole handler', () => {
  const createMockContext = ({
    isAdmin = true,
    guildId = 'guild-123',
    channelId = 'channel-456',
    role = 'role-1',
    message,
    interactionMessage,
    resolvedMessages,
    roles = [
      { id: 'role-1', name: 'VIP 🌟' },
      { id: 'role-no-emoji', name: 'Regular' },
    ],
    targetMessage = {
      id: 'target-msg-1',
      author: { id: 'target-user-1' },
    },
  }: {
    isAdmin?: boolean
    guildId?: string
    channelId?: string
    role?: string
    message?: string
    interactionMessage?: unknown
    resolvedMessages?: Record<string, unknown>
    roles?: { id: string; name: string }[]
    targetMessage?: { id: string; author?: { id: string } }
  }) => {
    const restCalls: {
      method: string
      path: string
      vars: unknown[]
      data?: unknown
    }[] = []
    const resMock = vi.fn((val: string) => val)

    const context = {
      interaction: {
        guild_id: guildId,
        channel_id: channelId,
        member: {
          permissions: isAdmin ? '8' : '0',
          roles: [],
        },
        message: interactionMessage,
        data: resolvedMessages
          ? { resolved: { messages: resolvedMessages } }
          : undefined,
      },
      env: {
        DISCORD_TEST_GUILD_ID: 'guild-123',
      },
      var: {
        role,
        message,
      },
      flags: vi.fn(() => ({
        res: resMock,
      })),
      rest: vi.fn(
        async (
          method: string,
          path: string,
          vars: unknown[],
          data?: unknown,
        ) => {
          restCalls.push({ method, path, vars, data })

          if (method === 'GET' && path === '/guilds/{guild.id}/roles') {
            return { ok: true, json: async () => roles }
          }
          if (
            method === 'GET' &&
            path === '/channels/{channel.id}/messages/{message.id}'
          ) {
            return { ok: true, json: async () => targetMessage }
          }
          if (method === 'GET' && path === '/channels/{channel.id}/messages') {
            return { ok: true, json: async () => [targetMessage] }
          }
          if (
            method === 'PUT' &&
            path === '/guilds/{guild.id}/members/{user.id}/roles/{role.id}'
          ) {
            return { ok: true, json: async () => ({}) }
          }
          if (
            method === 'PUT' &&
            path ===
              '/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me'
          ) {
            return { ok: true, json: async () => ({}) }
          }
          return { ok: true, json: async () => ({}) }
        },
      ),
    }

    return { context, restCalls, resMock }
  }

  it('rejects unauthorized users', async () => {
    const { context, resMock } = createMockContext({ isAdmin: false })

    await command_addRole.handler(context as never)

    expect(resMock).toHaveBeenCalledWith('Unauthorized.')
  })

  it('applies role and reacts with trailing emojis', async () => {
    const { context, restCalls, resMock } = createMockContext({
      role: 'role-1',
    })

    await command_addRole.handler(context as never)

    const rolePutCall = restCalls.find(
      (c) =>
        c.method === 'PUT' &&
        c.path === '/guilds/{guild.id}/members/{user.id}/roles/{role.id}',
    )
    expect(rolePutCall).toBeDefined()
    expect(rolePutCall?.vars).toEqual(['guild-123', 'target-user-1', 'role-1'])

    const reactCall = restCalls.find(
      (c) =>
        c.method === 'PUT' &&
        c.path ===
          '/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me',
    )
    expect(reactCall).toBeDefined()
    expect(reactCall?.vars[0]).toBe('channel-456')
    expect(reactCall?.vars[1]).toBe('target-msg-1')
    expect(decodeURIComponent(reactCall?.vars[2] as string)).toBe('🌟')

    expect(resMock).toHaveBeenCalledWith('Role applied and reactions added.')
  })

  it('applies role without reacting if role has no trailing emojis', async () => {
    const { context, restCalls, resMock } = createMockContext({
      role: 'role-no-emoji',
    })

    await command_addRole.handler(context as never)

    const rolePutCall = restCalls.find(
      (c) =>
        c.method === 'PUT' &&
        c.path === '/guilds/{guild.id}/members/{user.id}/roles/{role.id}',
    )
    expect(rolePutCall).toBeDefined()

    const reactCall = restCalls.find(
      (c) =>
        c.method === 'PUT' &&
        c.path ===
          '/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me',
    )
    expect(reactCall).toBeUndefined()

    expect(resMock).toHaveBeenCalledWith('Role applied.')
  })

  it('resolves message from interaction reply message', async () => {
    const { context, restCalls } = createMockContext({
      interactionMessage: {
        id: 'reply-msg-id',
        author: { id: 'reply-author-id' },
      },
    })

    await command_addRole.handler(context as never)

    const rolePutCall = restCalls.find(
      (c) =>
        c.method === 'PUT' &&
        c.path === '/guilds/{guild.id}/members/{user.id}/roles/{role.id}',
    )
    expect(rolePutCall?.vars[1]).toBe('reply-author-id')
  })
})
