import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals"
import { Client, TextChannel, CommandInteraction, AutocompleteInteraction } from "discord.js"
import { Robot } from "hubot"
import { LinearClient } from "@linear/sdk"
import crypto from "crypto"

// Mock dependencies
jest.mock("@linear/sdk")
jest.mock("crypto")

const MockedLinearClient = LinearClient as jest.MockedClass<typeof LinearClient>
const mockedCrypto = crypto as jest.Mocked<typeof crypto>

// Import the module under test after mocking
import linearIntegration from "../../discord-scripts/linear-integration.ts"

describe("Linear Integration", () => {
  let mockDiscordClient: jest.Mocked<Client>
  let mockRobot: jest.Mocked<Robot>
  let mockLinearClient: jest.Mocked<LinearClient>
  let mockChannel: jest.Mocked<TextChannel>
  let mockInteraction: jest.Mocked<CommandInteraction>
  let mockAutocompleteInteraction: jest.Mocked<AutocompleteInteraction>

  const mockTeamId = "team-123"
  const mockChannelId = "channel-456"
  const mockWebhookId = "webhook-789"
  const mockSecret = "test-secret"

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks()

    // Mock LinearClient
    mockLinearClient = {
      team: jest.fn(),
      teams: jest.fn(),
      createWebhook: jest.fn(),
      deleteWebhook: jest.fn(),
    } as any

    MockedLinearClient.mockImplementation(() => mockLinearClient)

    // Mock Discord Client
    mockDiscordClient = {
      application: {
        commands: {
          fetch: jest.fn().mockResolvedValue(new Map()),
          create: jest.fn(),
        },
      },
      on: jest.fn(),
      channels: {
        fetch: jest.fn(),
      },
    } as any

    // Mock TextChannel
    mockChannel = {
      id: mockChannelId,
      name: "test-channel",
      isSendable: jest.fn().mockReturnValue(true),
      send: jest.fn(),
    } as any

    // Mock CommandInteraction
    mockInteraction = {
      isChatInputCommand: jest.fn().mockReturnValue(true),
      commandName: "linear-updates",
      options: {
        getSubcommand: jest.fn(),
        getString: jest.fn(),
      },
      channel: mockChannel,
      channelId: mockChannelId,
      reply: jest.fn(),
      editReply: jest.fn(),
    } as any

    // Mock AutocompleteInteraction
    mockAutocompleteInteraction = {
      isAutocomplete: jest.fn().mockReturnValue(true),
      commandName: "linear-updates",
      channelId: mockChannelId,
      options: {
        getSubcommand: jest.fn(),
        getFocused: jest.fn(),
      },
      respond: jest.fn(),
    } as any

    // Mock Robot
    mockRobot = {
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
      brain: {
        get: jest.fn(),
        set: jest.fn(),
      },
      router: {
        post: jest.fn(),
      },
    } as any

    // Mock crypto
    mockedCrypto.randomBytes = jest.fn().mockReturnValue({
      toString: jest.fn().mockReturnValue(mockSecret),
    } as any)

    mockedCrypto.createHmac = jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("test-signature"),
    } as any)

    // Set environment variables
    process.env.LINEAR_API_TOKEN = "test-token"
    process.env.VALKYRIE_WEBHOOK_URL = "https://test.com/"
  })

  afterEach(() => {
    jest.useRealTimers()
    delete process.env.LINEAR_API_TOKEN
    delete process.env.VALKYRIE_WEBHOOK_URL
  })

  describe("Disconnect Command", () => {
    test("should successfully disconnect a connected team", async () => {
      // Arrange
      const mockTeam = { id: mockTeamId, name: "Test Team" }
      const mockConnection = {
        webhookUrl: "https://test.com/webhook",
        linearWebhookId: mockWebhookId,
        secret: mockSecret,
        teamId: mockTeamId,
        channelId: mockChannelId,
      }

      const existingConnections = {
        [mockTeamId]: {
          [mockChannelId]: mockConnection,
        },
      }

      mockInteraction.options.getSubcommand.mockReturnValue("disconnect")
      mockInteraction.options.getString.mockReturnValue(mockTeamId)
      mockRobot.brain.get.mockReturnValue({ connections: existingConnections })
      mockLinearClient.team.mockResolvedValue(mockTeam as any)
      mockLinearClient.deleteWebhook.mockResolvedValue(undefined as any)

      // Set up event handlers
      let interactionHandler: any
      mockDiscordClient.on.mockImplementation((event, handler) => {
        if (event === "interactionCreate") {
          interactionHandler = handler
        }
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await interactionHandler(mockInteraction)

      // Assert
      expect(mockLinearClient.deleteWebhook).toHaveBeenCalledWith(mockWebhookId)
      expect(mockRobot.brain.set).toHaveBeenCalledWith("linear", {
        connections: {},
      })
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: "Disconnected Linear team **Test Team** updates from this channel.",
        ephemeral: true,
      })
    })

    test("should handle disconnecting non-existent connection", async () => {
      // Arrange
      mockInteraction.options.getSubcommand.mockReturnValue("disconnect")
      mockInteraction.options.getString.mockReturnValue(mockTeamId)
      mockRobot.brain.get.mockReturnValue({ connections: {} })

      let interactionHandler: any
      mockDiscordClient.on.mockImplementation((event, handler) => {
        if (event === "interactionCreate") {
          interactionHandler = handler
        }
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await interactionHandler(mockInteraction)

      // Assert
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: "This team is not connected to this channel",
        ephemeral: true,
      })
      expect(mockLinearClient.deleteWebhook).not.toHaveBeenCalled()
    })

    test("should handle webhook deletion errors gracefully", async () => {
      // Arrange
      const mockTeam = { id: mockTeamId, name: "Test Team" }
      const mockConnection = {
        webhookUrl: "https://test.com/webhook",
        linearWebhookId: mockWebhookId,
        secret: mockSecret,
        teamId: mockTeamId,
        channelId: mockChannelId,
      }

      const existingConnections = {
        [mockTeamId]: {
          [mockChannelId]: mockConnection,
        },
      }

      mockInteraction.options.getSubcommand.mockReturnValue("disconnect")
      mockInteraction.options.getString.mockReturnValue(mockTeamId)
      mockRobot.brain.get.mockReturnValue({ connections: existingConnections })
      mockLinearClient.team.mockResolvedValue(mockTeam as any)
      mockLinearClient.deleteWebhook.mockRejectedValue(new Error("Webhook deletion failed"))

      let interactionHandler: any
      mockDiscordClient.on.mockImplementation((event, handler) => {
        if (event === "interactionCreate") {
          interactionHandler = handler
        }
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await interactionHandler(mockInteraction)

      // Assert
      expect(mockRobot.logger.error).toHaveBeenCalledWith(
        `Error deleting webhook with ID ${mockWebhookId}:`,
        expect.any(Error)
      )
      expect(mockRobot.brain.set).toHaveBeenCalledWith("linear", {
        connections: {},
      })
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: "Disconnected Linear team **Test Team** updates from this channel.",
        ephemeral: true,
      })
    })

    test("should handle missing webhook ID in connection", async () => {
      // Arrange
      const mockTeam = { id: mockTeamId, name: "Test Team" }
      const mockConnection = {
        webhookUrl: "https://test.com/webhook",
        linearWebhookId: "", // Empty webhook ID
        secret: mockSecret,
        teamId: mockTeamId,
        channelId: mockChannelId,
      }

      const existingConnections = {
        [mockTeamId]: {
          [mockChannelId]: mockConnection,
        },
      }

      mockInteraction.options.getSubcommand.mockReturnValue("disconnect")
      mockInteraction.options.getString.mockReturnValue(mockTeamId)
      mockRobot.brain.get.mockReturnValue({ connections: existingConnections })
      mockLinearClient.team.mockResolvedValue(mockTeam as any)

      let interactionHandler: any
      mockDiscordClient.on.mockImplementation((event, handler) => {
        if (event === "interactionCreate") {
          interactionHandler = handler
        }
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await interactionHandler(mockInteraction)

      // Assert
      expect(mockRobot.logger.error).toHaveBeenCalledWith("No webhook ID found in connection")
      expect(mockLinearClient.deleteWebhook).not.toHaveBeenCalled()
    })

    test("should reject invalid team ID", async () => {
      // Arrange
      mockInteraction.options.getSubcommand.mockReturnValue("disconnect")
      mockInteraction.options.getString.mockReturnValue("")

      let interactionHandler: any
      mockDiscordClient.on.mockImplementation((event, handler) => {
        if (event === "interactionCreate") {
          interactionHandler = handler
        }
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await interactionHandler(mockInteraction)

      // Assert
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: "Please provide a valid team ID.",
        ephemeral: true,
      })
    })

    test("should reject command in non-text channel", async () => {
      // Arrange
      const mockNonTextChannel = {
        id: mockChannelId,
        name: "test-channel",
      }

      const mockNonTextInteraction = {
        ...mockInteraction,
        channel: mockNonTextChannel,
      }

      mockNonTextInteraction.options.getSubcommand.mockReturnValue("disconnect")
      mockNonTextInteraction.options.getString.mockReturnValue(mockTeamId)

      let interactionHandler: any
      mockDiscordClient.on.mockImplementation((event, handler) => {
        if (event === "interactionCreate") {
          interactionHandler = handler
        }
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await interactionHandler(mockNonTextInteraction)

      // Assert
      expect(mockNonTextInteraction.reply).toHaveBeenCalledWith({
        content: "This command must be used in a text channel.",
        ephemeral: true,
      })
    })
  })

  describe("Disconnect Autocomplete", () => {
    test("should return only connected teams for disconnect autocomplete", async () => {
      // Arrange
      const mockTeam1 = { id: "team-1", name: "Connected Team 1" }
      const mockTeam2 = { id: "team-2", name: "Connected Team 2" }
      const mockTeam3 = { id: "team-3", name: "Another Team" }

      const existingConnections = {
        "team-1": {
          [mockChannelId]: { /* connection data */ },
        },
        "team-2": {
          [mockChannelId]: { /* connection data */ },
        },
        "team-3": {
          "other-channel": { /* connection data */ },
        },
      }

      mockAutocompleteInteraction.options.getSubcommand.mockReturnValue("disconnect")
      mockAutocompleteInteraction.options.getFocused.mockReturnValue({
        name: "team",
        value: "Connected",
      })
      mockRobot.brain.get.mockReturnValue({ connections: existingConnections })

      // Mock LinearClient.team calls
      mockLinearClient.team
        .mockResolvedValueOnce(mockTeam1 as any)
        .mockResolvedValueOnce(mockTeam2 as any)

      let autocompleteHandler: any
      mockDiscordClient.on.mockImplementation((event, handler) => {
        if (event === "interactionCreate") {
          autocompleteHandler = handler
        }
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await autocompleteHandler(mockAutocompleteInteraction)

      // Assert
      expect(mockAutocompleteInteraction.respond).toHaveBeenCalledWith([
        { name: "Connected Team 1", value: "team-1" },
        { name: "Connected Team 2", value: "team-2" },
      ])
    })

    test("should handle empty connections in disconnect autocomplete", async () => {
      // Arrange
      mockAutocompleteInteraction.options.getSubcommand.mockReturnValue("disconnect")
      mockAutocompleteInteraction.options.getFocused.mockReturnValue({
        name: "team",
        value: "",
      })
      mockRobot.brain.get.mockReturnValue({ connections: {} })

      let autocompleteHandler: any
      mockDiscordClient.on.mockImplementation((event, handler) => {
        if (event === "interactionCreate") {
          autocompleteHandler = handler
        }
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await autocompleteHandler(mockAutocompleteInteraction)

      // Assert
      expect(mockAutocompleteInteraction.respond).toHaveBeenCalledWith([])
    })

    test("should handle Linear API errors in disconnect autocomplete", async () => {
      // Arrange
      const existingConnections = {
        "team-1": {
          [mockChannelId]: { /* connection data */ },
        },
      }

      mockAutocompleteInteraction.options.getSubcommand.mockReturnValue("disconnect")
      mockAutocompleteInteraction.options.getFocused.mockReturnValue({
        name: "team",
        value: "",
      })
      mockRobot.brain.get.mockReturnValue({ connections: existingConnections })
      mockLinearClient.team.mockRejectedValue(new Error("API Error"))

      let autocompleteHandler: any
      mockDiscordClient.on.mockImplementation((event, handler) => {
        if (event === "interactionCreate") {
          autocompleteHandler = handler
        }
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await autocompleteHandler(mockAutocompleteInteraction)

      // Assert
      expect(mockRobot.logger.error).toHaveBeenCalledWith(
        "Error fetching team team-1:",
        expect.any(Error)
      )
      expect(mockAutocompleteInteraction.respond).toHaveBeenCalledWith([])
    })

    test("should filter teams by name in disconnect autocomplete", async () => {
      // Arrange
      const mockTeam1 = { id: "team-1", name: "Production Team" }
      const mockTeam2 = { id: "team-2", name: "Development Team" }

      const existingConnections = {
        "team-1": {
          [mockChannelId]: { /* connection data */ },
        },
        "team-2": {
          [mockChannelId]: { /* connection data */ },
        },
      }

      mockAutocompleteInteraction.options.getSubcommand.mockReturnValue("disconnect")
      mockAutocompleteInteraction.options.getFocused.mockReturnValue({
        name: "team",
        value: "prod",
      })
      mockRobot.brain.get.mockReturnValue({ connections: existingConnections })

      mockLinearClient.team
        .mockResolvedValueOnce(mockTeam1 as any)
        .mockResolvedValueOnce(mockTeam2 as any)

      let autocompleteHandler: any
      mockDiscordClient.on.mockImplementation((event, handler) => {
        if (event === "interactionCreate") {
          autocompleteHandler = handler
        }
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await autocompleteHandler(mockAutocompleteInteraction)

      // Assert
      expect(mockAutocompleteInteraction.respond).toHaveBeenCalledWith([
        { name: "Production Team", value: "team-1" },
      ])
    })
  })

  describe("Webhook Processing", () => {
    test("should verify webhook signature correctly", async () => {
      // Arrange
      const mockEventData = {
        type: "ProjectUpdate",
        data: { id: "1", body: "Test update" },
        webhookId: mockWebhookId,
      }

      const mockConnection = {
        webhookUrl: "https://test.com/webhook",
        linearWebhookId: mockWebhookId,
        secret: mockSecret,
        teamId: mockTeamId,
        channelId: mockChannelId,
      }

      const existingConnections = {
        [mockTeamId]: {
          [mockChannelId]: mockConnection,
        },
      }

      const mockRequest = {
        body: mockEventData,
        params: [mockChannelId, "123456"],
        headers: {
          "linear-signature": "test-signature",
        },
      }

      const mockResponse = {
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn(),
      }

      mockRobot.brain.get.mockReturnValue({ connections: existingConnections })
      mockDiscordClient.channels.fetch.mockResolvedValue(mockChannel as any)

      // Mock the HMAC verification
      const mockHmac = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("test-signature"),
      }
      mockedCrypto.createHmac.mockReturnValue(mockHmac as any)

      let webhookHandler: any
      mockRobot.router.post.mockImplementation((route, handler) => {
        webhookHandler = handler
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await webhookHandler(mockRequest, mockResponse)

      // Assert
      expect(mockedCrypto.createHmac).toHaveBeenCalledWith("sha256", mockSecret)
      expect(mockHmac.update).toHaveBeenCalledWith(JSON.stringify(mockEventData))
      expect(mockResponse.writeHead).toHaveBeenCalledWith(200)
      expect(mockResponse.end).toHaveBeenCalledWith("Event processed.")
    })

    test("should reject webhook with invalid signature", async () => {
      // Arrange
      const mockEventData = {
        type: "ProjectUpdate",
        data: { id: "1", body: "Test update" },
        webhookId: mockWebhookId,
      }

      const mockConnection = {
        webhookUrl: "https://test.com/webhook",
        linearWebhookId: mockWebhookId,
        secret: mockSecret,
        teamId: mockTeamId,
        channelId: mockChannelId,
      }

      const existingConnections = {
        [mockTeamId]: {
          [mockChannelId]: mockConnection,
        },
      }

      const mockRequest = {
        body: mockEventData,
        params: [mockChannelId, "123456"],
        headers: {
          "linear-signature": "invalid-signature",
        },
      }

      const mockResponse = {
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn(),
      }

      mockRobot.brain.get.mockReturnValue({ connections: existingConnections })
      mockDiscordClient.channels.fetch.mockResolvedValue(mockChannel as any)

      // Mock the HMAC verification to return different signature
      const mockHmac = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("different-signature"),
      }
      mockedCrypto.createHmac.mockReturnValue(mockHmac as any)

      let webhookHandler: any
      mockRobot.router.post.mockImplementation((route, handler) => {
        webhookHandler = handler
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await webhookHandler(mockRequest, mockResponse)

      // Assert
      expect(mockRobot.logger.error).toHaveBeenCalledWith("Signature verification failed.")
      expect(mockResponse.writeHead).toHaveBeenCalledWith(403)
      expect(mockResponse.end).toHaveBeenCalledWith("Forbidden: Invalid signature.")
    })

    test("should handle missing signature in webhook request", async () => {
      // Arrange
      const mockEventData = {
        type: "ProjectUpdate",
        data: { id: "1", body: "Test update" },
        webhookId: mockWebhookId,
      }

      const mockConnection = {
        webhookUrl: "https://test.com/webhook",
        linearWebhookId: mockWebhookId,
        secret: mockSecret,
        teamId: mockTeamId,
        channelId: mockChannelId,
      }

      const existingConnections = {
        [mockTeamId]: {
          [mockChannelId]: mockConnection,
        },
      }

      const mockRequest = {
        body: mockEventData,
        params: [mockChannelId, "123456"],
        headers: {}, // No signature header
      }

      const mockResponse = {
        writeHead: jest.fn().mockReturnThis(),
        end: jest.fn(),
      }

      mockRobot.brain.get.mockReturnValue({ connections: existingConnections })
      mockDiscordClient.channels.fetch.mockResolvedValue(mockChannel as any)

      let webhookHandler: any
      mockRobot.router.post.mockImplementation((route, handler) => {
        webhookHandler = handler
      })

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)
      await webhookHandler(mockRequest, mockResponse)

      // Assert
      expect(mockRobot.logger.error).toHaveBeenCalledWith("Missing Linear signature in request headers.")
      expect(mockResponse.writeHead).toHaveBeenCalledWith(400)
      expect(mockResponse.end).toHaveBeenCalledWith("Missing signature.")
    })
  })

  describe("Environment Variables", () => {
    test("should abort if LINEAR_API_TOKEN is not set", async () => {
      // Arrange
      delete process.env.LINEAR_API_TOKEN

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)

      // Assert
      expect(mockRobot.logger.error).toHaveBeenCalledWith(
        "Linear API token is not set. aborting Linear integration."
      )
      expect(mockDiscordClient.on).not.toHaveBeenCalled()
    })

    test("should abort if VALKYRIE_WEBHOOK_URL is not set", async () => {
      // Arrange
      delete process.env.VALKYRIE_WEBHOOK_URL

      // Act
      await linearIntegration(mockDiscordClient, mockRobot)

      // Assert
      expect(mockRobot.logger.error).toHaveBeenCalledWith(
        "No Valkyrie Webhook URL being set, aborting Linear integration."
      )
      expect(mockDiscordClient.on).not.toHaveBeenCalled()
    })
  })
})