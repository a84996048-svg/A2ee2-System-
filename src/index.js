const path = require('node:path');
const { configDotenv } = require('dotenv');

const envPath = path.resolve(__dirname, '..', '.env');
const dotenvResult = configDotenv({ path: envPath });
console.log('Bot startup: cwd=', process.cwd());
console.log('Bot startup: script dir=', __dirname);
console.log('Bot startup: loading env from', envPath);
console.log('Bot startup: dotenv loaded =', Boolean(dotenvResult.parsed));
console.log('Bot startup: DISCORD_TOKEN present =', !!process.env.DISCORD_TOKEN);
console.log('Bot startup: GUILD_ID present =', !!process.env.GUILD_ID);
console.log('Bot startup: OWNER_ID present =', !!process.env.OWNER_ID);

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const config = require('./config');
const store = require('./dataStore');

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled promise rejection:', reason, promise);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('warning', (warning) => {
  console.warn('Node warning:', warning.name, warning.message);
});

process.on('exit', (code) => {
  console.error('Process exit event: code =', code);
});

process.on('SIGINT', () => {
  console.error('Process received SIGINT, exiting');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Process received SIGTERM, exiting');
  process.exit(0);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

client.on('ready', () => {
  console.log(`Bot ready: ${client.user.tag}`);
  registerSlashCommands();
});

client.on('shardError', (error) => {
  console.error('Shard error:', error);
});

client.on('warn', (warning) => {
  console.warn('Discord client warning:', warning);
});

client.on('invalidated', () => {
  console.error('Discord session invalidated.');
});

client.on('rateLimit', (info) => {
  console.warn('Discord rate limit:', info);
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

function isOwner(userId) {
  return String(userId) === String(config.ownerId);
}

function hasAccess(userId) {
  if (isOwner(userId)) return true;
  if (!config.access.enabled || !config.features.accessSystem) return true;
  return (store.getAccessUsers() || []).map(String).includes(String(userId));
}

function hasRole(member, roleId) {
  if (!member || !member.roles) return false;
  return member.roles.cache.some((role) => String(role.id) === String(roleId));
}

function hasPointsPermission(member) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  return hasRole(member, config.roles.pointsManager);
}

function isPointsReceiver(member) {
  if (!member) return false;
  return hasRole(member, config.roles.pointsReceiver);
}

function canManageRole(member, targetRole) {
  if (!member || !targetRole) return false;
  if (isOwner(member.id)) return true;

  const botMember = member.guild.members.cache.get(client.user.id);
  if (!botMember) return false;

  if (targetRole.managed || targetRole.id === member.guild.roles.everyone.id) return false;

  const memberHighest = member.roles.highest?.position ?? -1;
  const botHighest = botMember.roles.highest?.position ?? -1;

  if (targetRole.position >= memberHighest) return false;
  if (targetRole.position >= botHighest) return false;

  return true;
}

function makeEmbed(title, description, imageUrl = null) {
  const embed = new EmbedBuilder().setColor(config.embeds.color).setTitle(title).setDescription(description || '');
  if (imageUrl) embed.setImage(imageUrl);
  return embed;
}

function makeWarningEmbed(moderatorId, reason, warningNumber, serverName) {
  return new EmbedBuilder()
    .setColor(config.embeds.color)
    .setTitle('تحذير إداري')
    .setDescription(`تم توجيه هذا التحذير لك في سيرفر **${serverName}**.`)
    .addFields(
      { name: 'المشرف', value: `<@${moderatorId}>`, inline: true },
      { name: 'رقم التحذير', value: `${warningNumber}`, inline: true },
      { name: 'السيرفر', value: serverName, inline: true },
      { name: 'السبب', value: reason || 'بدون سبب', inline: false }
    );
}

function createPrivetMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin-menu')
    .setPlaceholder('اختر القسم')
    .addOptions(
      ...config.adminMenu.options.map((option) => ({
        label: option.label,
        value: option.value,
        description: option.description
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function createPrivetSectionEmbed(value) {
  const section = config.adminMenu.sections[value] || config.adminMenu.intro;
  const embed = new EmbedBuilder()
    .setColor(config.embeds.color)
    .setTitle(config.adminMenu.title)
    .setDescription(section)
    .setImage(config.adminMenu.banner);
  return embed;
}

function makeUsageText(usage) {
  return config.messages.invalidUsage.replace('{usage}', usage);
}

async function sendNoPermission(replyTo, text = config.messages.noPermission) {
  if (!replyTo) return;
  if (typeof replyTo.reply === 'function') {
    await replyTo.reply(text).catch(() => {});
    return;
  }
  if (typeof replyTo.send === 'function') {
    await replyTo.send(text).catch(() => {});
  }
}

async function logAction({ executedBy, target, action, result, details }) {
  if (!config.features.logs) return;
  let channel = client.channels.cache.get(config.logs.channelId);
  if (!channel) {
    channel = await client.channels.fetch(config.logs.channelId).catch((error) => {
      console.error('Failed to fetch log channel:', error);
      return null;
    });
  }
  if (!channel || typeof channel.send !== 'function') return;

  const embed = new EmbedBuilder()
    .setColor(config.embeds.color)
    .setTitle('نظام اللوق')
    .addFields(
      { name: 'المنفذ', value: executedBy ? `<@${executedBy}>` : 'غير معروف', inline: true },
      { name: 'العضو', value: target ? `<@${target}>` : '—', inline: true },
      { name: 'العملية', value: action || 'غير محدد', inline: true },
      { name: 'النتيجة', value: result || '—', inline: true },
      { name: 'التفاصيل', value: details || '—', inline: false }
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch((error) => {
    console.error('Failed to send action log:', error);
  });
}

function getTargetMember(guild, value) {
  if (!guild || !value) return null;
  const cleaned = String(value).replace(/<@!?|>/g, '');
  if (/^\d+$/.test(cleaned)) return guild.members.cache.get(cleaned) || null;
  return guild.members.cache.find((member) => member.user.username.toLowerCase() === cleaned.toLowerCase()) || null;
}

function getTargetRole(guild, value) {
  if (!guild || !value) return null;
  const cleaned = String(value).replace(/<@&?|>/g, '');
  if (/^\d+$/.test(cleaned)) return guild.roles.cache.get(cleaned) || null;
  return guild.roles.cache.find((role) => role.name.toLowerCase() === cleaned.toLowerCase()) || null;
}

function cleanupMentionArgs(args, targetUserId) {
  return (args || []).filter((arg) => {
    if (!arg) return false;
    if (String(arg).includes(String(targetUserId))) return false;
    return !String(arg).startsWith('<@');
  });
}

const slashCommands = [
  { name: 'ping', description: 'Check bot ping' },
  { name: 'profile', description: 'Show profile info', options: [{ name: 'user', type: 6, description: 'User to inspect', required: false }] },
  { name: 'server', description: 'Show server info' },
  { name: 'user', description: 'Show user info', options: [{ name: 'user', type: 6, description: 'User to inspect', required: false }] },
  { name: 'avatar', description: 'Show avatar', options: [{ name: 'user', type: 6, description: 'User to inspect', required: false }] },
  { name: 'help', description: 'Show help menu' },
  { name: 'privet', description: 'Open the admin systems menu' },
  { name: 'top', description: 'Show points leaderboard' },
  { name: 'access', description: 'Manage access list', options: [
    { name: 'add', type: 1, description: 'Add user to access', options: [{ name: 'user', type: 6, description: 'User to add', required: true }] },
    { name: 'remove', type: 1, description: 'Remove user from access', options: [{ name: 'user', type: 6, description: 'User to remove', required: true }] },
    { name: 'list', type: 1, description: 'List access users' }
  ] },
  { name: 'points', description: 'Manage points', options: [
    { name: 'add', type: 1, description: 'Add points to a user', options: [{ name: 'user', type: 6, description: 'User to modify', required: true }, { name: 'amount', type: 4, description: 'Points to add', required: true }] },
    { name: 'remove', type: 1, description: 'Remove points from a user', options: [{ name: 'user', type: 6, description: 'User to modify', required: true }, { name: 'amount', type: 4, description: 'Points to remove', required: true }] },
    { name: 'set', type: 1, description: 'Set user points', options: [{ name: 'user', type: 6, description: 'User to modify', required: true }, { name: 'amount', type: 4, description: 'New points total', required: true }] },
    { name: 'remove-user', type: 1, description: 'Remove user data from points list', options: [{ name: 'user', type: 6, description: 'User to remove', required: true }] }
  ] },
  { name: 'role', description: 'Manage user roles', options: [
    { name: 'add', type: 1, description: 'Add role to user', options: [{ name: 'user', type: 6, description: 'User', required: true }, { name: 'role', type: 8, description: 'Role', required: true }] },
    { name: 'remove', type: 1, description: 'Remove role from user', options: [{ name: 'user', type: 6, description: 'User', required: true }, { name: 'role', type: 8, description: 'Role', required: true }] }
  ] },
  { name: 'lock', description: 'Lock the current channel' },
  { name: 'unlock', description: 'Unlock the current channel' },
  { name: 'ban', description: 'Ban a user', options: [{ name: 'user', type: 6, description: 'User to ban', required: true }] },
  { name: 'kick', description: 'Kick a user', options: [{ name: 'user', type: 6, description: 'User to kick', required: true }] },
  { name: 'timeout', description: 'Timeout a user', options: [{ name: 'user', type: 6, description: 'User to timeout', required: true }, { name: 'minutes', type: 4, description: 'Timeout minutes', required: true }] },
  { name: 'remove-timeout', description: 'Remove timeout from a user', options: [{ name: 'user', type: 6, description: 'User', required: true }] },
  { name: 'warn', description: 'Warn a user', options: [{ name: 'user', type: 6, description: 'User to warn', required: true }, { name: 'reason', type: 3, description: 'Warning reason', required: false }] },
  { name: 'warnings', description: 'Show user warnings', options: [{ name: 'user', type: 6, description: 'User to inspect', required: false }] },
  { name: 'say', description: 'Send a message', options: [{ name: 'message', type: 3, description: 'Message content', required: true }, { name: 'embed', type: 5, description: 'Send as embed', required: false }] },
  { name: 'clear', description: 'Clear messages', options: [{ name: 'amount', type: 4, description: 'Messages to delete', required: true }] },
  { name: 'slowmode', description: 'Set slowmode', options: [{ name: 'seconds', type: 4, description: 'Slowmode seconds', required: true }] },
  { name: 'nickname', description: 'Set nickname', options: [{ name: 'user', type: 6, description: 'User to rename', required: true }, { name: 'nickname', type: 3, description: 'New nickname', required: true }] },
  { name: 'channel-info', description: 'Get channel info' },
  { name: 'membercount', description: 'Get member count' },
  { name: 'server-icon', description: 'Show server icon' },
  { name: 'server-banner', description: 'Show server banner' }
];

async function registerSlashCommands() {
  const guildId = process.env.GUILD_ID;
  if (!guildId) {
    console.error('Missing GUILD_ID environment variable; slash commands cannot be registered.');
    return;
  }

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch((error) => {
    console.error('Failed to fetch guild for slash command registration:', error);
    return null;
  });

  if (!guild) return;
  await guild.commands.set(slashCommands).catch((error) => {
    console.error('Failed to register slash commands:', error);
  });
}

function answerRestricted(interaction) {
  if (interaction && typeof interaction.reply === 'function' && !interaction.replied) {
    interaction.reply({ content: config.messages.noAccess, ephemeral: true }).catch(() => {});
  }
}

async function handlePrefixCommand(message) {
  const prefix = config.commands.prefix;
  if (!message.content.startsWith(prefix) || message.author.bot) return;
  if (!message.guild) return;

  if (!hasAccess(message.author.id)) {
    await message.reply(config.messages.noAccess).catch(() => {});
    return;
  }

  const raw = message.content.slice(prefix.length).trim();
  if (!raw) return;

  const args = raw.split(/\s+/);
  const command = args.shift().toLowerCase();
  const member = message.guild.members.cache.get(message.author.id);

  if (command === 'access' || command === 'اكسب') {
    if (!isOwner(message.author.id)) return sendNoPermission(message);
    const action = args[0]?.toLowerCase();
    const target = message.mentions.users.first() || args[1] || null;
    if (!action || !target) {
      await message.reply(makeUsageText('!access add @User')).catch(() => {});
      return;
    }
    const targetId = String(target).replace(/<@|>|!/g, '');
    if (action === 'add' || action === 'اضافة') {
      store.addAccessUser(targetId);
      await message.react('✅').catch(() => {});
      logAction({ executedBy: message.author.id, target: targetId, action: 'Access Add', result: 'نجاح', details: 'إضافة حساب إلى قائمة Access' });
      return;
    }
    if (action === 'remove' || action === 'حذف') {
      store.removeAccessUser(targetId);
      await message.react('✅').catch(() => {});
      logAction({ executedBy: message.author.id, target: targetId, action: 'Access Remove', result: 'نجاح', details: 'إزالة حساب من قائمة Access' });
      return;
    }
    if (action === 'list' || action === 'قائمة') {
      const list = (store.getAccessUsers() || []).map((id) => `<@${id}>`).join(', ') || 'لا يوجد مستخدمين';
      await message.reply({ embeds: [makeEmbed('Access', list)] }).catch(() => {});
      return;
    }
    await message.reply(makeUsageText('!access add @User')).catch(() => {});
    return;
  }

  if (command === 'n' || command === 'نقاط') {
    const target = message.mentions.members.first();
    if (!target) {
      await message.reply(makeUsageText('!n @User +10')).catch(() => {});
      return;
    }
    if (!hasPointsPermission(member)) {
      await message.reply(config.messages.noPermission).catch(() => {});
      return;
    }

    const cleanArgs = cleanupMentionArgs(args, target.id);
    const firstArg = cleanArgs[0];
    const secondArg = cleanArgs[1];

    let op = null;
    let amount = null;

    if (/^\d+$/.test(firstArg) && ['+', '-'].includes(secondArg)) {
      op = secondArg;
      amount = Number(firstArg);
    } else if (['+', '-', 'add', 'remove', 'set'].includes(firstArg)) {
      op = firstArg;
      amount = Number(secondArg);
    } else if (/^[+-]?\d+$/.test(firstArg)) {
      op = firstArg.startsWith('-') ? '-' : firstArg.startsWith('+') ? '+' : 'set';
      amount = Number(firstArg);
    } else if (firstArg && ['+', '-', 'add', 'remove', 'set'].includes(secondArg)) {
      op = secondArg;
      amount = Number(firstArg);
    }

    if (!op || Number.isNaN(amount)) {
      await message.reply(makeUsageText('!n @User +10')).catch(() => {});
      return;
    }

    const before = store.getUserPoints(target.id);
    let after = before;
    if (op === '+' || op === 'add') {
      after = Math.max(config.points.minimum, before + amount);
      store.setUserPoints(target.id, after);
    } else if (op === '-' || op === 'remove') {
      after = Math.max(config.points.minimum, before - amount);
      store.setUserPoints(target.id, after);
    } else if (op === 'set') {
      after = Math.max(config.points.minimum, amount);
      store.setUserPoints(target.id, after);
    } else {
      await message.reply(makeUsageText('!n @User +10')).catch(() => {});
      return;
    }

    await message.react(config.points.addEmoji).catch(() => {});
    logAction({ executedBy: message.author.id, target: target.id, action: op === '+' || op === 'add' ? 'إضافة نقاط' : op === '-' || op === 'remove' ? 'خصم نقاط' : 'تحديد نقاط', result: 'نجاح', details: `التغيير: ${op === '+' || op === 'add' ? '+' : op === '-' || op === 'remove' ? '-' : ''}${amount} | قبل: ${before} | بعد: ${after}` });
    return;
  }

  if (command === 'points' || command === 'نقاطات') {
    if (args[0] === 'remove-user') {
      if (!hasPointsPermission(member)) {
        await message.reply(config.messages.noPermission).catch(() => {});
        return;
      }
      const id = args[1];
      if (!id) {
        await message.reply(makeUsageText('!points remove-user 123456789')).catch(() => {});
        return;
      }
      store.removeUserData(id);
      await message.react('✅').catch(() => {});
      logAction({ executedBy: message.author.id, target: id, action: 'Remove User Points', result: 'نجاح', details: 'حذف بيانات نقاط مستخدم من القائمة' });
      return;
    }
  }

  if (command === 'top' || command === 'توب') {
    const list = store.getTopUsers();
    const text = list.length
      ? list.map((entry, index) => `${index + 1}. <@${entry.userId}> — ${entry.points}`).join('\n')
      : 'لا يوجد أي مستخدم لديه نقاط.';
    await message.reply({ embeds: [makeEmbed(`${config.points.topEmoji} Top Points`, text, config.points.banner)] }).catch(() => {});
    return;
  }

  if (command === 'help' || command === 'مساعدة') {
    const menu = new StringSelectMenuBuilder().setCustomId('help-menu').setPlaceholder('اختر القسم').addOptions(
      { label: 'الإدارة', value: 'management' },
      { label: 'الأعضاء', value: 'members' },
      { label: 'النقاط', value: 'points' },
      { label: 'السيرفر', value: 'server' },
      { label: 'البوت', value: 'bot' }
    );
    const row = new ActionRowBuilder().addComponents(menu);
    await message.reply({ embeds: [makeEmbed('مساعدة البوت', 'اختر القسم من القائمة:')], components: [row] }).catch(() => {});
    return;
  }

  if (command === 'privet') {
    const intro = makeEmbed(config.adminMenu.title, config.adminMenu.intro, config.adminMenu.banner);
    await message.reply({ embeds: [intro], components: [createPrivetMenu()] }).catch(() => {});
    return;
  }

  if (command === 'profile' || command === 'p' || command === 'بروفايل') {
    const target = message.mentions.users.first() || message.author;
    await message.reply({ embeds: [makeEmbed('Profile', `العضو: <@${target.id}>\nID: ${target.id}`)] }).catch(() => {});
    return;
  }

  if (command === 'server' || command === 'serverinfo') {
    const guild = message.guild;
    await message.reply({ embeds: [makeEmbed('Server', `اسم السيرفر: ${guild.name}\nالأعضاء: ${guild.memberCount}`)] }).catch(() => {});
    return;
  }

  if (command === 'user' || command === 'u') {
    const target = message.mentions.users.first() || message.author;
    await message.reply({ embeds: [makeEmbed('User', `العضو: <@${target.id}>\nID: ${target.id}`)] }).catch(() => {});
    return;
  }

  if (command === 'avatar' || command === 'av' || command === 'افتار') {
    const target = message.mentions.users.first() || message.author;
    const avatar = target.displayAvatarURL({ dynamic: true, size: 512 });
    await message.reply({ embeds: [makeEmbed('Avatar', `[عرض الصورة](${avatar})`)] }).catch(() => {});
    return;
  }

  if (command === 'ping') {
    await message.reply({ embeds: [makeEmbed('Ping', `${client.ws.ping}ms`)] }).catch(() => {});
    return;
  }

  if (command === 'ban' || command === 'باند') {
    if (!member?.permissions.has('BanMembers')) {
      await message.reply(config.messages.noPermission).catch(() => {});
      return;
    }
    const target = message.mentions.members.first();
    if (!target) {
      await message.reply(makeUsageText('!ban @User')).catch(() => {});
      return;
    }
    await target.ban({ reason: 'Bot ban command' }).catch(() => {});
    await message.react('✅').catch(() => {});
    logAction({ executedBy: message.author.id, target: target.id, action: 'Ban', result: 'نجاح', details: 'حظر المستخدم' });
    return;
  }

  if (command === 'kick' || command === 'كيك') {
    if (!member?.permissions.has('KickMembers')) {
      await message.reply(config.messages.noPermission).catch(() => {});
      return;
    }
    const target = message.mentions.members.first();
    if (!target) {
      await message.reply(makeUsageText('!kick @User')).catch(() => {});
      return;
    }
    await target.kick('Bot kick command').catch(() => {});
    await message.react('✅').catch(() => {});
    logAction({ executedBy: message.author.id, target: target.id, action: 'Kick', result: 'نجاح', details: 'طرد المستخدم' });
    return;
  }

  if (command === 'timeout' || command === 'time' || command === 'تايم') {
    if (!member?.permissions.has('ModerateMembers')) {
      await message.reply(config.messages.noPermission).catch(() => {});
      return;
    }
    const target = message.mentions.members.first();
    const minutes = Number(args[1] || 5);
    if (!target) {
      await message.reply(makeUsageText('!timeout @User 10')).catch(() => {});
      return;
    }
    await target.timeout(minutes * 60 * 1000, 'Bot timeout').catch(() => {});
    await message.react('✅').catch(() => {});
    logAction({ executedBy: message.author.id, target: target.id, action: 'Timeout', result: 'نجاح', details: `وقت الإيقاف: ${minutes} دقيقة` });
    return;
  }

  if (command === 'remove-timeout' || command === 'rtime' || command === 'تكلم') {
    if (!member?.permissions.has('ModerateMembers')) {
      await message.reply(config.messages.noPermission).catch(() => {});
      return;
    }
    const target = message.mentions.members.first();
    if (!target) {
      await message.reply(makeUsageText('!remove-timeout @User')).catch(() => {});
      return;
    }
    await target.timeout(null).catch(() => {});
    await message.react('✅').catch(() => {});
    logAction({ executedBy: message.author.id, target: target.id, action: 'Remove Timeout', result: 'نجاح', details: 'إزالة timeout' });
    return;
  }

  if (command === 'warn' || command === 'تحذير') {
    if (!member?.permissions.has('KickMembers')) {
      await message.reply(config.messages.noPermission).catch(() => {});
      return;
    }
    const targetMember = message.mentions.members.first();
    const reason = args.slice(1).join(' ') || 'بدون سبب';
    if (!targetMember) {
      await message.reply(makeUsageText('!تحذير @User السبب')).catch(() => {});
      return;
    }
    const targetUser = targetMember.user;
    const warnings = store.addWarning(targetUser.id, reason);
    const warningNumber = warnings.length;
    const dmEmbed = makeWarningEmbed(message.author.id, reason, warningNumber, message.guild.name);
    const dmSent = await targetUser.send({ embeds: [dmEmbed] }).then(() => true).catch(() => false);
    if (!dmSent) {
      await message.reply('تعذر إرسال التحذير في الخاص. تأكد أن الخاص مفتوح.').catch(() => {});
      return;
    }
    await message.react('✅').catch(() => {});
    logAction({ executedBy: message.author.id, target: targetUser.id, action: 'Warn', result: 'نجاح', details: `السبب: ${reason}` });
    return;
  }

  if (command === 'warnings' || command === 'تحذيرات') {
    const target = message.mentions.users.first() || message.author;
    const warnings = store.getWarnings(target.id);
    const text = warnings.length ? warnings.map((w, i) => `${i + 1}. ${w.reason}`).join('\n') : 'لا توجد تنبيهات.';
    await message.reply({ embeds: [makeEmbed('Warnings', text)] }).catch(() => {});
    return;
  }

  if (command === 'role' || command === 'r') {
    const targetUser = message.mentions.members.first();
    if (!targetUser) {
      await message.reply(makeUsageText('!r @User @Role')).catch(() => {});
      return;
    }

    const action = ['add', 'remove'].includes(args[0]?.toLowerCase()) ? args[0].toLowerCase() : 'toggle';
    const roleInput = message.mentions.roles.first()?.id || (action === 'toggle' ? args[0] : args[1]) || args[2];
    const targetRole = getTargetRole(message.guild, roleInput);

    if (!targetRole) {
      await message.reply(makeUsageText('!r @User @Role')).catch(() => {});
      return;
    }

    if (!canManageRole(member, targetRole)) {
      await message.reply(config.messages.roleProtection).catch(() => {});
      return;
    }

    const hasRoleAlready = targetUser.roles.cache.has(targetRole.id);
    if (action === 'add') {
      await targetUser.roles.add(targetRole).catch(() => {});
      await message.react('✅').catch(() => {});
      logAction({ executedBy: message.author.id, target: targetUser.id, action: 'Role Add', result: 'نجاح', details: `إضافة رتبة: ${targetRole.name}` });
      return;
    }

    if (action === 'remove') {
      await targetUser.roles.remove(targetRole).catch(() => {});
      await message.react('✅').catch(() => {});
      logAction({ executedBy: message.author.id, target: targetUser.id, action: 'Role Remove', result: 'نجاح', details: `إزالة رتبة: ${targetRole.name}` });
      return;
    }

    if (hasRoleAlready) {
      await targetUser.roles.remove(targetRole).catch(() => {});
      await message.react('✅').catch(() => {});
      logAction({ executedBy: message.author.id, target: targetUser.id, action: 'Role Remove', result: 'نجاح', details: `إزالة رتبة: ${targetRole.name}` });
      return;
    }

    await targetUser.roles.add(targetRole).catch(() => {});
    await message.react('✅').catch(() => {});
    logAction({ executedBy: message.author.id, target: targetUser.id, action: 'Role Add', result: 'نجاح', details: `إضافة رتبة: ${targetRole.name}` });
    return;
  }

  if (command === 'lock' || command === 'ق') {
    if (!message.channel || message.channel.type !== ChannelType.GuildText) return;
    await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false }).catch(() => {});
    await message.react('✅').catch(() => {});
    logAction({ executedBy: message.author.id, target: message.channel.id, action: 'Lock', result: 'نجاح', details: `قفل الروم: ${message.channel.name}` });
    return;
  }

  if (command === 'unlock' || command === 'ف') {
    if (!message.channel || message.channel.type !== ChannelType.GuildText) return;
    await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: null }).catch(() => {});
    await message.react('✅').catch(() => {});
    logAction({ executedBy: message.author.id, target: message.channel.id, action: 'Unlock', result: 'نجاح', details: `فتح الروم: ${message.channel.name}` });
    return;
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!config.features.prefixCommands) return;
  await handlePrefixCommand(message);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isStringSelectMenu() && interaction.customId === 'help-menu') {
    const sections = {
      management: 'الإدارة: /ban, /kick, /timeout, /warn, /clear, /slowmode, /nickname',
      members: 'الأعضاء: /profile, /user, /avatar, /membercount',
      points: 'النقاط: /points add, /points remove, /points set, /top',
      server: 'السيرفر: /server, /server icon, /server banner, /channel info',
      bot: 'البوت: /help, /ping, /access list'
    };
    const section = interaction.values[0];
    await interaction.update({ embeds: [makeEmbed(`قسم ${section}`, sections[section] || 'لا يوجد قسم')], components: [] }).catch(() => {});
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'admin-menu') {
    const value = interaction.values[0];
    await interaction.reply({ embeds: [createPrivetSectionEmbed(value)], ephemeral: true }).catch(() => {});
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (!hasAccess(interaction.user.id)) {
    answerRestricted(interaction);
    return;
  }

  const { commandName, options, guild } = interaction;

  if (commandName === 'help') {
    const menu = new StringSelectMenuBuilder().setCustomId('help-menu').setPlaceholder('اختر القسم').addOptions(
      { label: 'الإدارة', value: 'management' },
      { label: 'الأعضاء', value: 'members' },
      { label: 'النقاط', value: 'points' },
      { label: 'السيرفر', value: 'server' },
      { label: 'البوت', value: 'bot' }
    );
    await interaction.reply({ embeds: [makeEmbed('مساعدة البوت', 'اختر القسم من القائمة:')], components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => {});
    return;
  }

  if (commandName === 'privet') {
    await interaction.reply({ embeds: [makeEmbed(config.adminMenu.title, config.adminMenu.intro, config.adminMenu.banner)], components: [createPrivetMenu()] }).catch(() => {});
    return;
  }

  if (commandName === 'top') {
    const list = store.getTopUsers();
    const text = list.length ? list.map((entry, index) => `${index + 1}. <@${entry.userId}> — ${entry.points}`).join('\n') : 'لا يوجد أي مستخدم لديه نقاط.';
    await interaction.reply({ embeds: [makeEmbed(`${config.points.topEmoji}Top Points`, text, config.points.banner)] }).catch(() => {});
    return;
  }

  if (commandName === 'ping') {
    await interaction.reply({ embeds: [makeEmbed('Ping', `${client.ws.ping}ms`)] }).catch(() => {});
    return;
  }

  if (commandName === 'profile') {
    const target = options.getUser('user') || interaction.user;
    await interaction.reply({ embeds: [makeEmbed('Profile', `العضو: <@${target.id}>\nID: ${target.id}`)] }).catch(() => {});
    return;
  }

  if (commandName === 'server') {
    await interaction.reply({ embeds: [makeEmbed('Server', `اسم السيرفر: ${guild.name}\nالأعضاء: ${guild.memberCount}`)] }).catch(() => {});
    return;
  }

  if (commandName === 'user') {
    const target = options.getUser('user') || interaction.user;
    await interaction.reply({ embeds: [makeEmbed('User', `العضو: <@${target.id}>\nID: ${target.id}`)] }).catch(() => {});
    return;
  }

  if (commandName === 'avatar') {
    const target = options.getUser('user') || interaction.user;
    const avatar = target.displayAvatarURL({ dynamic: true, size: 512 });
    await interaction.reply({ embeds: [makeEmbed('Avatar', `[عرض الصورة](${avatar})`)] }).catch(() => {});
    return;
  }

  if (commandName === 'access') {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: config.messages.noPermission, ephemeral: true }).catch(() => {});
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'list') {
      const list = (store.getAccessUsers() || []).map((id) => `<@${id}>`).join(', ') || 'لا يوجد مستخدمين';
      await interaction.reply({ embeds: [makeEmbed('Access', list)] }).catch(() => {});
      return;
    }
    const user = interaction.options.getUser('user');
    if (subcommand === 'add') {
      store.addAccessUser(user.id);
      await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
      logAction({ executedBy: interaction.user.id, target: user.id, action: 'Access Add', result: 'نجاح', details: 'إضافة حساب إلى Access' });
      return;
    }
    if (subcommand === 'remove') {
      store.removeAccessUser(user.id);
      await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
      logAction({ executedBy: interaction.user.id, target: user.id, action: 'Access Remove', result: 'نجاح', details: 'إزالة حساب من Access' });
      return;
    }
  }

  if (commandName === 'points') {
    const member = guild.members.cache.get(interaction.user.id);
    if (!hasPointsPermission(member)) {
      await interaction.reply({ content: config.messages.noPermission, ephemeral: true }).catch(() => {});
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount') || 0;
    const before = store.getUserPoints(targetUser.id);
    let after = before;

    if (subcommand === 'add') {
      after = Math.max(config.points.minimum, before + amount);
      store.setUserPoints(targetUser.id, after);
      await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
      logAction({ executedBy: interaction.user.id, target: targetUser.id, action: 'إضافة نقاط', result: 'نجاح', details: `التغيير: +${amount} | قبل: ${before} | بعد: ${after}` });
      return;
    }

    if (subcommand === 'remove') {
      after = Math.max(config.points.minimum, before - amount);
      store.setUserPoints(targetUser.id, after);
      await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
      logAction({ executedBy: interaction.user.id, target: targetUser.id, action: 'خصم نقاط', result: 'نجاح', details: `التغيير: -${amount} | قبل: ${before} | بعد: ${after}` });
      return;
    }

    if (subcommand === 'set') {
      after = Math.max(config.points.minimum, amount);
      store.setUserPoints(targetUser.id, after);
      await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
      logAction({ executedBy: interaction.user.id, target: targetUser.id, action: 'تحديد نقاط', result: 'نجاح', details: `قبل: ${before} | بعد: ${after}` });
      return;
    }

    if (subcommand === 'remove-user') {
      store.removeUserData(targetUser.id);
      await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
      logAction({ executedBy: interaction.user.id, target: targetUser.id, action: 'Remove User Points', result: 'نجاح', details: 'حذف بيانات نقاط من القائمة' });
      return;
    }
  }

  if (commandName === 'role') {
    const member = guild.members.cache.get(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getMember('user');
    const targetRole = interaction.options.getRole('role');
    if (!targetUser || !targetRole) {
      await interaction.reply({ content: makeUsageText('/role add @User @Role'), ephemeral: true }).catch(() => {});
      return;
    }
    if (!canManageRole(member, targetRole)) {
      await interaction.reply({ content: config.messages.roleProtection, ephemeral: true }).catch(() => {});
      return;
    }

    if (subcommand === 'add') {
      await targetUser.roles.add(targetRole).catch(() => {});
      await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
      logAction({ executedBy: interaction.user.id, target: targetUser.id, action: 'Role Add', result: 'نجاح', details: `إضافة رتبة: ${targetRole.name}` });
      return;
    }

    if (subcommand === 'remove') {
      await targetUser.roles.remove(targetRole).catch(() => {});
      await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
      logAction({ executedBy: interaction.user.id, target: targetUser.id, action: 'Role Remove', result: 'نجاح', details: `إزالة رتبة: ${targetRole.name}` });
      return;
    }
  }

  if (commandName === 'lock') {
    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) return;
    await interaction.channel.permissionOverwrites.edit(guild.id, { SendMessages: false }).catch(() => {});
    await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
    logAction({ executedBy: interaction.user.id, target: interaction.channel.id, action: 'Lock', result: 'نجاح', details: `قفل الروم: ${interaction.channel.name}` });
    return;
  }

  if (commandName === 'unlock') {
    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) return;
    await interaction.channel.permissionOverwrites.edit(guild.id, { SendMessages: null }).catch(() => {});
    await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
    logAction({ executedBy: interaction.user.id, target: interaction.channel.id, action: 'Unlock', result: 'نجاح', details: `فتح الروم: ${interaction.channel.name}` });
    return;
  }

  if (commandName === 'ban') {
    const memberToBan = interaction.options.getMember('user');
    if (!memberToBan) {
      await interaction.reply({ content: makeUsageText('/ban @User'), ephemeral: true }).catch(() => {});
      return;
    }
    await guild.members.ban(memberToBan.id).catch(() => {});
    await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
    logAction({ executedBy: interaction.user.id, target: memberToBan.id, action: 'Ban', result: 'نجاح', details: 'حظر المستخدم' });
    return;
  }

  if (commandName === 'kick') {
    const memberToKick = interaction.options.getMember('user');
    if (!memberToKick) {
      await interaction.reply({ content: makeUsageText('/kick @User'), ephemeral: true }).catch(() => {});
      return;
    }
    await memberToKick.kick('Bot kick command').catch(() => {});
    await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
    logAction({ executedBy: interaction.user.id, target: memberToKick.id, action: 'Kick', result: 'نجاح', details: 'طرد المستخدم' });
    return;
  }

  if (commandName === 'timeout') {
    const memberToTimeout = interaction.options.getMember('user');
    const minutes = interaction.options.getInteger('minutes') || 5;
    await memberToTimeout.timeout(minutes * 60 * 1000, 'Bot timeout').catch(() => {});
    await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
    logAction({ executedBy: interaction.user.id, target: memberToTimeout.id, action: 'Timeout', result: 'نجاح', details: `وقت الإيقاف: ${minutes} دقيقة` });
    return;
  }

  if (commandName === 'remove-timeout') {
    const memberToUnTimeout = interaction.options.getMember('user');
    await memberToUnTimeout.timeout(null).catch(() => {});
    await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
    logAction({ executedBy: interaction.user.id, target: memberToUnTimeout.id, action: 'Remove Timeout', result: 'نجاح', details: 'إزالة timeout' });
    return;
  }

  if (commandName === 'warn') {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'بدون سبب';
    const warnings = store.addWarning(target.id, reason);
    const warningNumber = warnings.length;
    await interaction.reply({ embeds: [makeWarningEmbed(interaction.user.id, reason, warningNumber, guild.name)], ephemeral: true }).catch(() => {});
    logAction({ executedBy: interaction.user.id, target: target.id, action: 'Warn', result: 'نجاح', details: `السبب: ${reason}` });
    return;
  }

  if (commandName === 'warnings') {
    const target = interaction.options.getUser('user') || interaction.user;
    const warnings = store.getWarnings(target.id);
    const text = warnings.length ? warnings.map((w, i) => `${i + 1}. ${w.reason}`).join('\n') : 'لا توجد تنبيهات.';
    await interaction.reply({ embeds: [makeEmbed('Warnings', text)] }).catch(() => {});
    return;
  }

  if (commandName === 'say') {
    const content = interaction.options.getString('message');
    const asEmbed = interaction.options.getBoolean('embed');
    if (asEmbed) {
      await interaction.channel.send({ embeds: [makeEmbed('Message', content)] }).catch(() => {});
    } else {
      await interaction.channel.send(content).catch(() => {});
    }
    await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
    return;
  }

  if (commandName === 'clear') {
    const amount = interaction.options.getInteger('amount') || 10;
    await interaction.channel.bulkDelete(Math.min(amount, 100)).catch(() => {});
    await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
    logAction({ executedBy: interaction.user.id, target: interaction.channel.id, action: 'Clear', result: 'نجاح', details: `حذف ${amount} رسالة` });
    return;
  }

  if (commandName === 'slowmode') {
    const seconds = interaction.options.getInteger('seconds') || 0;
    await interaction.channel.setRateLimitPerUser(seconds).catch(() => {});
    await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
    logAction({ executedBy: interaction.user.id, target: interaction.channel.id, action: 'Slowmode', result: 'نجاح', details: `تعيين slowmode لـ ${seconds} ثانية` });
    return;
  }

  if (commandName === 'nickname') {
    const target = interaction.options.getMember('user');
    const nickname = interaction.options.getString('nickname');
    await target.setNickname(nickname).catch(() => {});
    await interaction.reply({ content: '✅', ephemeral: true }).catch(() => {});
    logAction({ executedBy: interaction.user.id, target: target.id, action: 'Nickname', result: 'نجاح', details: `تعيين لقب: ${nickname}` });
    return;
  }

  if (commandName === 'channel-info') {
    const channel = interaction.channel;
    await interaction.reply({ embeds: [makeEmbed('Channel Info', `الاسم: ${channel.name}\nالنوع: ${channel.type}`)] }).catch(() => {});
    return;
  }

  if (commandName === 'membercount') {
    await interaction.reply({ embeds: [makeEmbed('Member Count', `${guild.memberCount}`)] }).catch(() => {});
    return;
  }

  if (commandName === 'server-icon') {
    const icon = guild.iconURL({ dynamic: true, size: 512 });
    await interaction.reply({ embeds: [makeEmbed('Server Icon', `[عرض الأيقونة](${icon})`)] }).catch(() => {});
    return;
  }

  if (commandName === 'server-banner') {
    const banner = guild.bannerURL({ size: 512 });
    await interaction.reply({ embeds: [makeEmbed('Server Banner', banner ? `[عرض البانر](${banner})` : 'لا يوجد بانر')] }).catch(() => {});
    return;
  }

  await interaction.reply({ content: 'هذا الأمر غير مُعرّف حاليًا.', ephemeral: true }).catch(() => {});
});

const https = require('node:https');
const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error('Missing DISCORD_TOKEN environment variable. Please set DISCORD_TOKEN in the environment.');
  process.exit(1);
}

console.log('DISCORD_TOKEN length =', token.length);
console.log('DISCORD_TOKEN contains whitespace =', /\s/.test(process.env.DISCORD_TOKEN || ''));

if (config.features.slashCommands && !process.env.GUILD_ID) {
  console.error('Missing GUILD_ID environment variable. Slash command registration will not run.');
}

function testDiscordApiConnectivity(botToken) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'discord.com',
      path: '/api/v10/gateway/bot',
      method: 'GET',
      headers: {
        Authorization: `Bot ${botToken}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('Discord API connectivity response:', res.statusCode);
        console.log('Discord API connectivity body:', data.slice(0, 512));
        resolve(res.statusCode);
      });
    });

    req.on('error', (error) => {
      console.error('Discord API connectivity error:', error);
      resolve(null);
    });

    req.end();
  });
}

(async () => {
  const statusCode = await testDiscordApiConnectivity(token);
  if (statusCode === 401) {
    console.error('Discord token is invalid. Please verify DISCORD_TOKEN.');
    process.exit(1);
  }
  if (statusCode === null) {
    console.error('Unable to reach Discord API from this environment. Check outbound network access.');
  }

  const loginTimeout = setTimeout(() => {
    console.error('Discord login has not completed after 20 seconds. The process may be blocked or unable to reach Discord.');
  }, 20000);

  console.log('Attempting Discord login...');
  client.login(token).then(() => {
    clearTimeout(loginTimeout);
    console.log('Discord login promise resolved.');
  }).catch((error) => {
    clearTimeout(loginTimeout);
    console.error('Failed to login:', error);
    process.exit(1);
  });
})();