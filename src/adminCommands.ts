import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  GuildMember,
  TextChannel,
  MessageFlags,
  Client,
} from "discord.js";
import ms from "ms";
import { dbOps } from "./db.ts";

export function parseDurationMs(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = ms(trimmed as ms.StringValue);
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

let tempbanTimer: ReturnType<typeof setInterval> | null = null;

export function startTempbanScheduler(client: Client): void {
  if (tempbanTimer) return;
  const processExpired = async () => {
    if (!client.isReady()) return;
    const due = dbOps.tempbans.listDue(Date.now());
    for (const ban of due) {
      dbOps.tempbans.remove(ban.guild_id, ban.user_id);
      try {
        const guild = await client.guilds.fetch(ban.guild_id);
        await guild.members.unban(ban.user_id, "Koniec tempbana");
      } catch {
        // User may already be unbanned or bot lacks permissions
      }
    }
  };

  tempbanTimer = setInterval(() => {
    processExpired().catch(() => {});
  }, 30_000);
  tempbanTimer.unref?.();
  processExpired().catch(() => {});
}

export const adminCommandsDefinitions = [
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Banuje użytkownika")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Powód")),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Odbanowuje użytkownika")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName("user_id").setDescription("ID Użytkownika").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Powód")),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Wyrzuca użytkownika")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Powód")),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Wycisza (timeout) użytkownika")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true))
    .addStringOption((o) =>
      o.setName("duration").setDescription("Czas (np. 10m, 1h, 1d)").setRequired(true)
    )
    .addStringOption((o) => o.setName("reason").setDescription("Powód")),
  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Odcisza użytkownika")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Powód")),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Czyści wiadomości")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName("amount").setDescription("Ilość (1-100)").setRequired(true)),
  new SlashCommandBuilder()
    .setName("clearuser")
    .setDescription("Czyści wiadomości użytkownika na tym kanale")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true))
    .addIntegerOption((o) =>
      o.setName("amount").setDescription("Ile wiadomości przeszukać (1-100)").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Zamyka kanał")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName("channel").setDescription("Kanał")),
  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Otwiera kanał")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName("channel").setDescription("Kanał")),
  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Ustawia slowmode")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((o) =>
      o.setName("seconds").setDescription("Sekundy (0 aby wyłączyć)").setRequired(true)
    )
    .addChannelOption((o) => o.setName("channel").setDescription("Kanał")),
  new SlashCommandBuilder()
    .setName("setnick")
    .setDescription("Zmienia pseudonim")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true))
    .addStringOption((o) =>
      o.setName("nick").setDescription("Nowy pseudonim (puste aby zresetować)")
    ),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Ostrzega użytkownika")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Powód").setRequired(true)),
  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Lista ostrzeżeń")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true)),
  new SlashCommandBuilder()
    .setName("clearwarns")
    .setDescription("Czyści ostrzeżenia")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true)),
  new SlashCommandBuilder()
    .setName("addrole")
    .setDescription("Dodaje rolę")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("Rola").setRequired(true)),
  new SlashCommandBuilder()
    .setName("removerole")
    .setDescription("Odbiera rolę")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("Rola").setRequired(true)),
  new SlashCommandBuilder()
    .setName("tempban")
    .setDescription("Tymczasowo banuje użytkownika")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik").setRequired(true))
    .addStringOption((o) =>
      o.setName("duration").setDescription("Czas (np. 1d, 1w, 30d)").setRequired(true)
    )
    .addStringOption((o) => o.setName("reason").setDescription("Powód")),
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Wysyła ogłoszenie")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName("message").setDescription("Wiadomość").setRequired(true))
    .addChannelOption((o) => o.setName("channel").setDescription("Kanał")),
  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Informacje o użytkowniku")
    .addUserOption((o) => o.setName("user").setDescription("Użytkownik")),
  new SlashCommandBuilder().setName("serverinfo").setDescription("Informacje o serwerze"),
  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Odświeża (klonuje i usuwa) obecny kanał")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName("ping").setDescription("Sprawdza opóźnienie bota"),
  new SlashCommandBuilder()
    .setName("createvoucher")
    .setDescription("Tworzy nowy voucher")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Typ vouchera")
        .setRequired(true)
        .addChoices(
          { name: "User Premium", value: "user_premium" },
          { name: "Guild Premium", value: "guild_premium" }
        )
    )
    .addStringOption((o) =>
      o.setName("duration").setDescription("Czas trwania (np. 30d, 1y)").setRequired(true)
    )
    .addIntegerOption((o) =>
      o.setName("max_uses").setDescription("Maksymalna liczba użyć (domyślnie 1)")
    ),
  new SlashCommandBuilder()
    .setName("redeem")
    .setDescription("Realizuje voucher")
    .addStringOption((o) => o.setName("code").setDescription("Kod vouchera").setRequired(true)),
];

export async function handleAdminCommands(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  const { commandName, guildId, guild } = interaction;
  if (!guild || !guildId) return false;

  const replyEphemeral = (content: string) =>
    interaction.reply({ content, flags: MessageFlags.Ephemeral });

  switch (commandName) {
    case "ping": {
      await replyEphemeral(`🏓 Pong! Opóźnienie: **${interaction.client.ws.ping}ms**`);
      return true;
    }
    case "ban": {
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "Brak powodu";
      try {
        await guild.members.ban(user, { reason });
        await replyEphemeral(`Zbanowano ${user.tag}. Powód: ${reason}`);
      } catch (e) {
        console.error(e);
        await replyEphemeral("Nie udało się zbanować. Sprawdź moje uprawnienia.");
      }
      return true;
    }
    case "tempban": {
      const user = interaction.options.getUser("user", true);
      const durationStr = interaction.options.getString("duration", true);
      const reason = interaction.options.getString("reason") || "Brak powodu";
      const duration = parseDurationMs(durationStr);
      if (!duration) {
        await replyEphemeral("Nieprawidłowy czas formatowany (np. 1d, 12h, 30d).");
        return true;
      }
      try {
        await guild.members.ban(user, { reason: `[Tempban ${durationStr}] ${reason}` });
        dbOps.tempbans.add(guildId, user.id, interaction.user.id, reason, Date.now() + duration);
        await replyEphemeral(
          `Tymczasowo zbanowano ${user.tag} na ${durationStr}. Powód: ${reason}`
        );
      } catch (e) {
        console.error(e);
        await replyEphemeral("Nie udało się zbanować. Sprawdź moje uprawnienia.");
      }
      return true;
    }
    case "unban": {
      const userId = interaction.options.getString("user_id", true);
      const reason = interaction.options.getString("reason") || "Brak powodu";
      try {
        await guild.members.unban(userId, reason);
        dbOps.tempbans.remove(guildId, userId);
        await replyEphemeral(`Odbanowano użytkownika o ID ${userId}. Powód: ${reason}`);
      } catch (e) {
        console.error(e);
        await replyEphemeral(
          "Nie udało się odbanować. Możliwe, że to nieprawidłowe ID lub użytkownik nie ma bana."
        );
      }
      return true;
    }
    case "kick": {
      const user = interaction.options.getMember("user") as GuildMember | null;
      const reason = interaction.options.getString("reason") || "Brak powodu";
      if (!user) {
        await replyEphemeral("Nie znaleziono użytkownika na serwerze.");
        return true;
      }
      try {
        await user.kick(reason);
        await replyEphemeral(`Wyrzucono ${user.user.tag}. Powód: ${reason}`);
      } catch (e) {
        console.error(e);
        await replyEphemeral("Nie udało się wyrzucić. Sprawdź moje uprawnienia.");
      }
      return true;
    }
    case "mute": {
      const user = interaction.options.getMember("user") as GuildMember | null;
      const durationStr = interaction.options.getString("duration", true);
      const reason = interaction.options.getString("reason") || "Brak powodu";
      if (!user) {
        await replyEphemeral("Nie znaleziono użytkownika na serwerze.");
        return true;
      }
      const duration = parseDurationMs(durationStr);
      if (!duration) {
        await replyEphemeral("Nieprawidłowy czas (np. 10m, 1h).");
        return true;
      }
      try {
        await user.timeout(duration, reason);
        await replyEphemeral(`Wyciszono ${user.user.tag} na ${durationStr}. Powód: ${reason}`);
      } catch (e) {
        console.error(e);
        await replyEphemeral(
          "Nie udało się wyciszyć. Sprawdź moje uprawnienia (czas musi być poniżej 28 dni)."
        );
      }
      return true;
    }
    case "unmute": {
      const user = interaction.options.getMember("user") as GuildMember | null;
      const reason = interaction.options.getString("reason") || "Brak powodu";
      if (!user) {
        await replyEphemeral("Nie znaleziono użytkownika na serwerze.");
        return true;
      }
      try {
        await user.timeout(null, reason);
        await replyEphemeral(`Odciszono ${user.user.tag}. Powód: ${reason}`);
      } catch (e) {
        console.error(e);
        await replyEphemeral("Nie udało się odciszyć. Sprawdź moje uprawnienia.");
      }
      return true;
    }
    case "clear": {
      const amount = interaction.options.getInteger("amount", true);
      if (amount < 1 || amount > 100) {
        await replyEphemeral("Podaj liczbę od 1 do 100.");
        return true;
      }
      const channel = interaction.channel as TextChannel;
      try {
        const deleted = await channel.bulkDelete(amount, true);
        await replyEphemeral(`Usunięto ${deleted.size} wiadomości.`);
      } catch (e) {
        console.error(e);
        await replyEphemeral(
          "Nie udało się usunąć wiadomości. Sprawdź uprawnienia lub czy wiadomości nie są starsze niż 14 dni."
        );
      }
      return true;
    }
    case "clearuser": {
      const targetUser = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      if (amount < 1 || amount > 100) {
        await replyEphemeral("Podaj liczbę od 1 do 100.");
        return true;
      }
      const channel = interaction.channel as TextChannel;
      try {
        const fetchMessages = await channel.messages.fetch({ limit: amount });
        const targetMessages = fetchMessages.filter((m) => m.author.id === targetUser.id);
        if (targetMessages.size === 0) {
          await replyEphemeral(
            `Nie znaleziono wiadomości gracza ${targetUser.tag} w ostatnich ${amount} wiadomościach.`
          );
          return true;
        }
        const deleted = await channel.bulkDelete(targetMessages, true);
        await replyEphemeral(`Usunięto ${deleted.size} wiadomości gracza ${targetUser.tag}.`);
      } catch (e) {
        console.error(e);
        await replyEphemeral(
          "Nie udało się usunąć wiadomości. Sprawdź uprawnienia lub czy wiadomości nie są starsze niż 14 dni."
        );
      }
      return true;
    }
    case "lock": {
      const channel = (interaction.options.getChannel("channel") ||
        interaction.channel) as TextChannel;
      if (!channel?.permissionOverwrites) {
        await replyEphemeral("To nie jest obsługiwany kanał.");
        return true;
      }
      try {
        await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
        await replyEphemeral(`Zawieszono pisanie na kanale ${channel}.`);
      } catch (e) {
        console.error(e);
        await replyEphemeral("Wystąpił błąd podczas zamykania kanału.");
      }
      return true;
    }
    case "unlock": {
      const channel = (interaction.options.getChannel("channel") ||
        interaction.channel) as TextChannel;
      if (!channel?.permissionOverwrites) {
        await replyEphemeral("To nie jest obsługiwany kanał.");
        return true;
      }
      try {
        await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
        await replyEphemeral(`Otwarto kanał ${channel}.`);
      } catch (e) {
        console.error(e);
        await replyEphemeral("Wystąpił błąd podczas otwierania kanału.");
      }
      return true;
    }
    case "slowmode": {
      const seconds = interaction.options.getInteger("seconds", true);
      const channel = (interaction.options.getChannel("channel") ||
        interaction.channel) as TextChannel;
      if (!channel?.setRateLimitPerUser) {
        await replyEphemeral("To nie jest obsługiwany kanał.");
        return true;
      }
      try {
        await channel.setRateLimitPerUser(seconds);
        await replyEphemeral(`Ustawiono slowmode na ${seconds} sekund na kanale ${channel}.`);
      } catch (e) {
        console.error(e);
        await replyEphemeral("Błąd podczas ustawiania slowmode.");
      }
      return true;
    }
    case "setnick": {
      const user = interaction.options.getMember("user") as GuildMember | null;
      const nick = interaction.options.getString("nick");
      if (!user) {
        await replyEphemeral("Nie znaleziono użytkownika na serwerze.");
        return true;
      }
      try {
        await user.setNickname(nick);
        await replyEphemeral(`Zmieniono pseudonim gracza ${user.user.tag}.`);
      } catch (e) {
        console.error(e);
        await replyEphemeral("Nie udało się zmienić nicku (może mam niższą rolę?).");
      }
      return true;
    }
    case "warn": {
      const target = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason", true);
      dbOps.warnings.add(guildId, target.id, interaction.user.id, reason);
      await replyEphemeral(`Ostrzeżono gracza ${target.tag}. Powód: ${reason}`);
      return true;
    }
    case "warnings": {
      const target = interaction.options.getUser("user", true);
      const warns = dbOps.warnings.list(guildId, target.id);
      if (warns.length === 0) {
        await replyEphemeral(`${target.tag} nie ma żadnych ostrzeżeń.`);
      } else {
        const text = warns
          .map(
            (w, i) =>
              `**${i + 1}.** Powód: ${w.reason} (przez <@${w.moderator_id}>, ${new Date(
                w.timestamp
              ).toLocaleDateString("pl-PL")})`
          )
          .join("\n");
        await replyEphemeral(`Ostrzeżenia gracza ${target.tag}:\n${text}`);
      }
      return true;
    }
    case "clearwarns": {
      const target = interaction.options.getUser("user", true);
      const removed = dbOps.warnings.clear(guildId, target.id);
      await replyEphemeral(`Wyczyszczono ${removed} ostrzeżeń gracza ${target.tag}.`);
      return true;
    }
    case "addrole": {
      const member = interaction.options.getMember("user") as GuildMember | null;
      const role = interaction.options.getRole("role", true);
      if (!member) {
        await replyEphemeral("Nie znaleziono użytkownika.");
        return true;
      }
      try {
        await member.roles.add(role.id);
        await replyEphemeral(`Dodano rolę ${role.name} użytkownikowi ${member.user.tag}.`);
      } catch (e) {
        console.error(e);
        await replyEphemeral("Błąd: brak uprawnień do przypisania tej roli.");
      }
      return true;
    }
    case "removerole": {
      const member = interaction.options.getMember("user") as GuildMember | null;
      const role = interaction.options.getRole("role", true);
      if (!member) {
        await replyEphemeral("Nie znaleziono użytkownika.");
        return true;
      }
      try {
        await member.roles.remove(role.id);
        await replyEphemeral(`Zabrano rolę ${role.name} użytkownikowi ${member.user.tag}.`);
      } catch (e) {
        console.error(e);
        await replyEphemeral("Błąd: brak uprawnień do odebrania tej roli.");
      }
      return true;
    }
    case "announce": {
      const message = interaction.options.getString("message", true);
      const channel = (interaction.options.getChannel("channel") ||
        interaction.channel) as TextChannel;
      if (!channel?.send) {
        await replyEphemeral("To nie jest prawidłowy kanał tekstowy.");
        return true;
      }
      try {
        await channel.send(message);
        await replyEphemeral(`Wysłano ogłoszenie na ${channel}.`);
      } catch (e) {
        console.error(e);
        await replyEphemeral("Błąd podczas wysyłania ogłoszenia.");
      }
      return true;
    }
    case "userinfo": {
      const user = interaction.options.getUser("user") || interaction.user;
      const member =
        (interaction.options.getMember("user") as GuildMember | null) ||
        (interaction.member as GuildMember | null);
      const roleCount = member?.roles?.cache.size || 0;
      await replyEphemeral(
        `**Info o ${user.tag}**\nID: ${user.id}\nDołączył do Discorda: ${user.createdAt.toLocaleDateString(
          "pl-PL"
        )}\nKonto Bota: ${user.bot ? "Tak" : "Nie"}\nIlość ról na serwerze: ${roleCount}`
      );
      return true;
    }
    case "serverinfo": {
      await replyEphemeral(
        `**Info o ${guild.name}**\nID: ${guild.id}\nUtworzony: ${guild.createdAt.toLocaleDateString(
          "pl-PL"
        )}\nCzłonkowie: ${guild.memberCount}\nIlość ról: ${guild.roles.cache.size}\nIlość kanałów: ${
          guild.channels.cache.size
        }`
      );
      return true;
    }
    case "nuke": {
      const channel = interaction.channel as TextChannel;
      if (!channel?.clone) {
        await replyEphemeral("Ten kanał nie może zostać zresetowany.");
        return true;
      }
      try {
        const cloned = await channel.clone();
        await cloned.setPosition(channel.position);
        await cloned.send("Nuked 💥");
        await channel.delete("Nuke command executed");
      } catch (e) {
        console.error(e);
        await replyEphemeral("Brak uprawnień by to zrobić.");
      }
      return true;
    }
    case "createvoucher": {
      const type = interaction.options.getString("type", true);
      const durationStr = interaction.options.getString("duration", true);
      const maxUses = interaction.options.getInteger("max_uses") || 1;
      const duration = parseDurationMs(durationStr);
      if (!duration) {
        await replyEphemeral("Nieprawidłowy czas (np. 30d, 1y).");
        return true;
      }

      const voucher = dbOps.vouchers.create(type, duration, maxUses, interaction.user.id);
      await replyEphemeral(
        `Utworzono voucher: **${voucher.code}**\nTyp: ${type}\nCzas: ${durationStr}\nUżycia: ${voucher.max_uses}`
      );
      return true;
    }
    case "redeem": {
      const code = interaction.options.getString("code", true).toUpperCase();
      const result = dbOps.vouchers.redeem(code, interaction.user.id, guildId, interaction.user.tag);
      if (!result.ok) {
        await replyEphemeral(result.error);
        return true;
      }
      await replyEphemeral(`Pomyślnie zrealizowano voucher! Typ nagrody: **${result.voucher.type}**`);
      return true;
    }
  }

  return false;
}
