import { CategoryChannel, ChannelType, Client, TextChannel } from "discord.js"
import { Robot } from "hubot"
import { RECREATIONAL_CATEGORY_ID } from "../lib/discord/utils.ts"

// Hardcoded channel-to-role mappings (mirrors auto-join.ts)
const CUSTOM_CHANNEL_ROLE = [
	{ channelName: "biz-dev-investor", roles: ["BD"] },
	{ channelName: "press-relations", roles: ["M Group", "Marketing"] },
	{ channelName: "mezo-marketing", roles: ["Mezo Marketing"] },
	{ channelName: "mezo-cathedral", roles: ["Mezo Cathedral"] },
	{ channelName: "mezo-ecosystem", roles: ["Mezo Ecosystem"] },
] as const

const AUTO_TAG_BRAIN_KEY = "auto-tag-roles"

type ChannelAutoTagInfo = {
	channelId: string
	channelName: string
	categoryId: string | null
	categoryName: string | null
	autoTagSource:
		| "custom-hardcoded"
		| "custom-brain"
		| "channel-name"
		| "category-name"
		| "everyone"
		| "none"
	roles: string[]
	isRecreational: boolean
}

type DashboardData = {
	channels: ChannelAutoTagInfo[]
	hardcodedMappings: typeof CUSTOM_CHANNEL_ROLE
	brainMappings: Record<string, string[]>
	recreationalCategoryId: string
}

function getDashboardHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Discord Auto-Tag Dashboard</title>
	<style>
		:root {
			--bg-primary: #1a1a2e;
			--bg-secondary: #16213e;
			--bg-card: #0f3460;
			--text-primary: #eaeaea;
			--text-secondary: #a0a0a0;
			--accent-blue: #4a90d9;
			--accent-green: #4caf50;
			--accent-orange: #ff9800;
			--accent-purple: #9c27b0;
			--accent-red: #e94560;
			--border-color: #2a4a6a;
		}

		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}

		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			background-color: var(--bg-primary);
			color: var(--text-primary);
			line-height: 1.6;
			padding: 2rem;
		}

		header {
			text-align: center;
			margin-bottom: 2rem;
		}

		h1 {
			font-size: 2rem;
			margin-bottom: 0.5rem;
		}

		.subtitle {
			color: var(--text-secondary);
			font-size: 1rem;
		}

		.dashboard-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
			gap: 1.5rem;
			max-width: 1600px;
			margin: 0 auto;
		}

		.card {
			background: var(--bg-secondary);
			border-radius: 12px;
			padding: 1.5rem;
			border: 1px solid var(--border-color);
		}

		.card-header {
			display: flex;
			align-items: center;
			gap: 0.75rem;
			margin-bottom: 1rem;
			padding-bottom: 0.75rem;
			border-bottom: 1px solid var(--border-color);
		}

		.card-header h2 {
			font-size: 1.25rem;
			font-weight: 600;
		}

		.badge {
			display: inline-block;
			padding: 0.25rem 0.75rem;
			border-radius: 999px;
			font-size: 0.75rem;
			font-weight: 600;
			text-transform: uppercase;
		}

		.badge-blue { background: var(--accent-blue); color: white; }
		.badge-green { background: var(--accent-green); color: white; }
		.badge-orange { background: var(--accent-orange); color: black; }
		.badge-purple { background: var(--accent-purple); color: white; }
		.badge-red { background: var(--accent-red); color: white; }
		.badge-gray { background: var(--text-secondary); color: white; }

		.channel-list {
			list-style: none;
		}

		.channel-item {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
			padding: 1rem;
			margin-bottom: 0.75rem;
			background: var(--bg-card);
			border-radius: 8px;
			border-left: 4px solid var(--accent-blue);
		}

		.channel-item.recreational {
			border-left-color: var(--accent-orange);
			opacity: 0.7;
		}

		.channel-item.no-tag {
			border-left-color: var(--text-secondary);
			opacity: 0.6;
		}

		.channel-name {
			font-weight: 600;
			font-size: 1rem;
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}

		.channel-name::before {
			content: "#";
			color: var(--text-secondary);
		}

		.channel-category {
			font-size: 0.85rem;
			color: var(--text-secondary);
		}

		.channel-roles {
			display: flex;
			flex-wrap: wrap;
			gap: 0.5rem;
			margin-top: 0.25rem;
		}

		.role-tag {
			display: inline-flex;
			align-items: center;
			gap: 0.25rem;
			padding: 0.25rem 0.5rem;
			background: var(--bg-secondary);
			border: 1px solid var(--border-color);
			border-radius: 4px;
			font-size: 0.85rem;
		}

		.role-tag::before {
			content: "@";
			color: var(--accent-blue);
		}

		.source-tag {
			font-size: 0.75rem;
			color: var(--text-secondary);
			font-style: italic;
		}

		.mapping-table {
			width: 100%;
			border-collapse: collapse;
		}

		.mapping-table th,
		.mapping-table td {
			padding: 0.75rem;
			text-align: left;
			border-bottom: 1px solid var(--border-color);
		}

		.mapping-table th {
			color: var(--text-secondary);
			font-weight: 500;
			font-size: 0.85rem;
			text-transform: uppercase;
		}

		.mapping-table td {
			font-size: 0.95rem;
		}

		.legend {
			display: flex;
			flex-wrap: wrap;
			gap: 1rem;
			margin-bottom: 2rem;
			justify-content: center;
		}

		.legend-item {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			font-size: 0.85rem;
		}

		.legend-color {
			width: 16px;
			height: 16px;
			border-radius: 4px;
		}

		.loading {
			text-align: center;
			padding: 2rem;
			color: var(--text-secondary);
		}

		.error {
			text-align: center;
			padding: 2rem;
			color: var(--accent-red);
		}

		.stats {
			display: flex;
			gap: 2rem;
			justify-content: center;
			margin-bottom: 2rem;
		}

		.stat-item {
			text-align: center;
		}

		.stat-value {
			font-size: 2rem;
			font-weight: 700;
			color: var(--accent-blue);
		}

		.stat-label {
			font-size: 0.85rem;
			color: var(--text-secondary);
		}

		.filter-bar {
			display: flex;
			gap: 1rem;
			margin-bottom: 1.5rem;
			flex-wrap: wrap;
			justify-content: center;
		}

		.filter-btn {
			padding: 0.5rem 1rem;
			border: 1px solid var(--border-color);
			background: var(--bg-secondary);
			color: var(--text-primary);
			border-radius: 6px;
			cursor: pointer;
			font-size: 0.9rem;
			transition: all 0.2s ease;
		}

		.filter-btn:hover {
			border-color: var(--accent-blue);
		}

		.filter-btn.active {
			background: var(--accent-blue);
			border-color: var(--accent-blue);
		}

		.rules-section {
			background: var(--bg-card);
			border-radius: 8px;
			padding: 1rem;
			margin-top: 1rem;
		}

		.rule-item {
			display: flex;
			align-items: flex-start;
			gap: 0.75rem;
			padding: 0.75rem 0;
			border-bottom: 1px solid var(--border-color);
		}

		.rule-item:last-child {
			border-bottom: none;
		}

		.rule-number {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 24px;
			height: 24px;
			background: var(--accent-blue);
			border-radius: 50%;
			font-size: 0.75rem;
			font-weight: 600;
			flex-shrink: 0;
		}

		.rule-text {
			font-size: 0.9rem;
		}

		.rule-text code {
			background: var(--bg-primary);
			padding: 0.125rem 0.375rem;
			border-radius: 4px;
			font-size: 0.85rem;
		}
	</style>
</head>
<body>
	<header>
		<h1>Discord Auto-Tag Dashboard</h1>
		<p class="subtitle">Visualizing channel auto-tagging behavior for Valkyrie bot</p>
	</header>

	<section class="legend">
		<p class="legend-item">
			<span class="legend-color" style="background: var(--accent-blue);"></span>
			<span>Active auto-tag</span>
		</p>
		<p class="legend-item">
			<span class="legend-color" style="background: var(--accent-orange);"></span>
			<span>Recreational (no tagging)</span>
		</p>
		<p class="legend-item">
			<span class="legend-color" style="background: var(--text-secondary);"></span>
			<span>No matching role</span>
		</p>
	</section>

	<section class="stats" id="stats">
		<p class="loading">Loading statistics...</p>
	</section>

	<section class="filter-bar" id="filters">
		<button class="filter-btn active" data-filter="all">All Channels</button>
		<button class="filter-btn" data-filter="hardcoded">Custom Hardcoded</button>
		<button class="filter-btn" data-filter="brain">Custom Brain</button>
		<button class="filter-btn" data-filter="channel">Channel Name Match</button>
		<button class="filter-btn" data-filter="category">Category Match</button>
		<button class="filter-btn" data-filter="recreational">Recreational</button>
	</section>

	<section class="dashboard-grid">
		<article class="card">
			<header class="card-header">
				<h2>Auto-Tagging Rules</h2>
				<span class="badge badge-blue">Priority Order</span>
			</header>
			<section class="rules-section">
				<p class="rule-item">
					<span class="rule-number">1</span>
					<span class="rule-text"><strong>Recreational category:</strong> Skip all tagging if channel is in the recreational category</span>
				</p>
				<p class="rule-item">
					<span class="rule-number">2</span>
					<span class="rule-text"><strong>Custom brain roles:</strong> Check <code>robot.brain</code> for custom roles set via <code>/auto-tag add</code></span>
				</p>
				<p class="rule-item">
					<span class="rule-number">3</span>
					<span class="rule-text"><strong>Hardcoded mappings:</strong> Check <code>CUSTOM_CHANNEL_ROLE</code> array for explicit channel-role mappings</span>
				</p>
				<p class="rule-item">
					<span class="rule-number">4</span>
					<span class="rule-text"><strong>Channel name match:</strong> Find a role matching the channel name (e.g., <code>#tech</code> → <code>@Tech</code>)</span>
				</p>
				<p class="rule-item">
					<span class="rule-number">5</span>
					<span class="rule-text"><strong>Category name match:</strong> Find a role matching the parent category name</span>
				</p>
				<p class="rule-item">
					<span class="rule-number">6</span>
					<span class="rule-text"><strong>General/Main:</strong> If category is "General" and channel is "main" or "bifrost" → <code>@everyone</code></span>
				</p>
			</section>
		</article>

		<article class="card">
			<header class="card-header">
				<h2>Hardcoded Channel Mappings</h2>
				<span class="badge badge-purple">Static Config</span>
			</header>
			<table class="mapping-table" id="hardcoded-table">
				<thead>
					<tr>
						<th>Channel</th>
						<th>Roles</th>
					</tr>
				</thead>
				<tbody id="hardcoded-body">
					<tr><td colspan="2" class="loading">Loading...</td></tr>
				</tbody>
			</table>
		</article>

		<article class="card">
			<header class="card-header">
				<h2>Dynamic Brain Mappings</h2>
				<span class="badge badge-green">Live Config</span>
			</header>
			<table class="mapping-table" id="brain-table">
				<thead>
					<tr>
						<th>Channel</th>
						<th>Roles</th>
					</tr>
				</thead>
				<tbody id="brain-body">
					<tr><td colspan="2" class="loading">Loading...</td></tr>
				</tbody>
			</table>
		</article>

		<article class="card" style="grid-column: 1 / -1;">
			<header class="card-header">
				<h2>All Channels with Auto-Tag Configuration</h2>
				<span class="badge badge-blue" id="channel-count">0 channels</span>
			</header>
			<ol class="channel-list" id="channel-list">
				<li class="loading">Loading channel data...</li>
			</ol>
		</article>
	</section>

	<script>
		let dashboardData = null;
		let currentFilter = 'all';

		async function fetchDashboardData() {
			try {
				const response = await fetch('/auto-tag-dashboard/api');
				if (!response.ok) throw new Error('Failed to fetch data');
				dashboardData = await response.json();
				renderDashboard();
			} catch (error) {
				document.getElementById('channel-list').innerHTML =
					'<li class="error">Failed to load data. Make sure the bot is running.</li>';
				document.getElementById('stats').innerHTML =
					'<p class="error">Unable to connect to bot API</p>';
			}
		}

		function renderDashboard() {
			if (!dashboardData) return;

			renderStats();
			renderHardcodedMappings();
			renderBrainMappings();
			renderChannelList();
			setupFilters();
		}

		function renderStats() {
			const { channels } = dashboardData;
			const activeChannels = channels.filter(c => !c.isRecreational && c.autoTagSource !== 'none');
			const recreationalChannels = channels.filter(c => c.isRecreational);
			const customChannels = channels.filter(c =>
				c.autoTagSource === 'custom-hardcoded' || c.autoTagSource === 'custom-brain'
			);

			document.getElementById('stats').innerHTML = \`
				<p class="stat-item">
					<span class="stat-value">\${channels.length}</span>
					<span class="stat-label">Total Channels</span>
				</p>
				<p class="stat-item">
					<span class="stat-value">\${activeChannels.length}</span>
					<span class="stat-label">With Auto-Tag</span>
				</p>
				<p class="stat-item">
					<span class="stat-value">\${customChannels.length}</span>
					<span class="stat-label">Custom Mappings</span>
				</p>
				<p class="stat-item">
					<span class="stat-value">\${recreationalChannels.length}</span>
					<span class="stat-label">Recreational</span>
				</p>
			\`;
		}

		function renderHardcodedMappings() {
			const { hardcodedMappings } = dashboardData;
			const tbody = document.getElementById('hardcoded-body');

			if (hardcodedMappings.length === 0) {
				tbody.innerHTML = '<tr><td colspan="2" class="loading">No hardcoded mappings</td></tr>';
				return;
			}

			tbody.innerHTML = hardcodedMappings.map(mapping => \`
				<tr>
					<td><span class="channel-name">\${mapping.channelName}</span></td>
					<td>\${mapping.roles.map(r => \`<span class="role-tag">\${r}</span>\`).join(' ')}</td>
				</tr>
			\`).join('');
		}

		function renderBrainMappings() {
			const { brainMappings, channels } = dashboardData;
			const tbody = document.getElementById('brain-body');
			const entries = Object.entries(brainMappings);

			if (entries.length === 0) {
				tbody.innerHTML = '<tr><td colspan="2" class="loading">No custom brain mappings configured</td></tr>';
				return;
			}

			tbody.innerHTML = entries.map(([channelId, roles]) => {
				const channel = channels.find(c => c.channelId === channelId);
				const channelName = channel ? channel.channelName : channelId;
				return \`
					<tr>
						<td><span class="channel-name">\${channelName}</span></td>
						<td>\${roles.map(r => \`<span class="role-tag">\${r}</span>\`).join(' ')}</td>
					</tr>
				\`;
			}).join('');
		}

		function getSourceBadge(source) {
			const badges = {
				'custom-hardcoded': '<span class="badge badge-purple">Hardcoded</span>',
				'custom-brain': '<span class="badge badge-green">Brain</span>',
				'channel-name': '<span class="badge badge-blue">Channel Match</span>',
				'category-name': '<span class="badge badge-blue">Category Match</span>',
				'everyone': '<span class="badge badge-orange">@everyone</span>',
				'none': '<span class="badge badge-gray">No Match</span>'
			};
			return badges[source] || '';
		}

		function renderChannelList() {
			const { channels } = dashboardData;
			const list = document.getElementById('channel-list');

			const filteredChannels = channels.filter(channel => {
				if (currentFilter === 'all') return true;
				if (currentFilter === 'hardcoded') return channel.autoTagSource === 'custom-hardcoded';
				if (currentFilter === 'brain') return channel.autoTagSource === 'custom-brain';
				if (currentFilter === 'channel') return channel.autoTagSource === 'channel-name';
				if (currentFilter === 'category') return channel.autoTagSource === 'category-name';
				if (currentFilter === 'recreational') return channel.isRecreational;
				return true;
			});

			document.getElementById('channel-count').textContent = \`\${filteredChannels.length} channels\`;

			if (filteredChannels.length === 0) {
				list.innerHTML = '<li class="loading">No channels match the current filter</li>';
				return;
			}

			// Group channels by category
			const byCategory = {};
			filteredChannels.forEach(channel => {
				const cat = channel.categoryName || 'Uncategorized';
				if (!byCategory[cat]) byCategory[cat] = [];
				byCategory[cat].push(channel);
			});

			list.innerHTML = Object.entries(byCategory)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([category, chans]) => \`
					<li>
						<strong style="color: var(--text-secondary); display: block; margin: 1rem 0 0.5rem;">\${category}</strong>
						<ol class="channel-list">
							\${chans.map(channel => \`
								<li class="channel-item \${channel.isRecreational ? 'recreational' : ''} \${channel.autoTagSource === 'none' ? 'no-tag' : ''}">
									<p class="channel-name">
										\${channel.channelName}
										\${getSourceBadge(channel.autoTagSource)}
									</p>
									\${channel.isRecreational ? '<p class="source-tag">Recreational - no auto-tagging</p>' : ''}
									\${!channel.isRecreational && channel.roles.length > 0 ? \`
										<p class="channel-roles">
											\${channel.roles.map(r => \`<span class="role-tag">\${r}</span>\`).join('')}
										</p>
									\` : ''}
									\${!channel.isRecreational && channel.roles.length === 0 ? '<p class="source-tag">No matching role found</p>' : ''}
								</li>
							\`).join('')}
						</ol>
					</li>
				\`).join('');
		}

		function setupFilters() {
			document.querySelectorAll('.filter-btn').forEach(btn => {
				btn.addEventListener('click', () => {
					document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
					btn.classList.add('active');
					currentFilter = btn.dataset.filter;
					renderChannelList();
				});
			});
		}

		// Initial load
		fetchDashboardData();

		// Refresh every 30 seconds
		setInterval(fetchDashboardData, 30000);
	</script>
</body>
</html>`
}

function getAutoTagSource(
	channelName: string,
	channelId: string,
	categoryName: string | null,
	brainMappings: Record<string, string[]>,
	serverRoleNames: string[],
): { source: ChannelAutoTagInfo["autoTagSource"]; roles: string[] } {
	// Check brain mappings first
	if (brainMappings[channelId] && brainMappings[channelId].length > 0) {
		return { source: "custom-brain", roles: brainMappings[channelId] }
	}

	// Check hardcoded mappings
	const hardcodedMapping = CUSTOM_CHANNEL_ROLE.find(
		(m) => m.channelName === channelName,
	)
	if (hardcodedMapping) {
		return { source: "custom-hardcoded", roles: [...hardcodedMapping.roles] }
	}

	// Check channel name match
	const normalize = (str: string) =>
		str
			.toLowerCase()
			.replace(/\s+/g, " ")
			.replace(/[^a-z -]/g, "")
			.trim()

	const channelNameNormalized = normalize(channelName.replace(/-/g, " "))
	const matchingChannelRole = serverRoleNames.find(
		(roleName) => normalize(roleName) === channelNameNormalized,
	)
	if (matchingChannelRole) {
		return { source: "channel-name", roles: [matchingChannelRole] }
	}

	// Check category name match
	if (categoryName) {
		const categoryNormalized = normalize(categoryName)
		const matchingCategoryRole = serverRoleNames.find(
			(roleName) => normalize(roleName) === categoryNormalized,
		)
		if (matchingCategoryRole) {
			return { source: "category-name", roles: [matchingCategoryRole] }
		}
	}

	// Check for General/main or bifrost
	if (
		categoryName?.toLowerCase()?.endsWith("general") &&
		(channelName.toLowerCase().endsWith("main") ||
			channelName.toLowerCase().endsWith("bifrost"))
	) {
		return { source: "everyone", roles: ["@everyone"] }
	}

	return { source: "none", roles: [] }
}

export default async function setupAutoTagDashboard(
	discordClient: Client,
	robot: Robot,
) {
	robot.logger.info("Setting up auto-tag dashboard...")

	// Serve dashboard HTML
	robot.router.get("/auto-tag-dashboard", (_req, res) => {
		res.setHeader("Content-Type", "text/html")
		res.send(getDashboardHtml())
	})

	// API endpoint for dashboard data
	robot.router.get("/auto-tag-dashboard/api", async (_req, res) => {
		try {
			const guild = discordClient.guilds.cache.first()
			if (!guild) {
				res.status(503).json({ error: "No guild available" })
				return
			}

			await guild.channels.fetch()
			await guild.roles.fetch()

			const brainMappings: Record<string, string[]> =
				robot.brain.get(AUTO_TAG_BRAIN_KEY) ?? {}
			const serverRoleNames = guild.roles.cache.map((r) => r.name)

			const channels: ChannelAutoTagInfo[] = []

			guild.channels.cache.forEach((channel) => {
				// Only include text channels that can have threads
				if (
					channel.type !== ChannelType.GuildText &&
					channel.type !== ChannelType.GuildAnnouncement &&
					channel.type !== ChannelType.GuildForum
				) {
					return
				}

				const textChannel = channel as TextChannel
				const category = textChannel.parent as CategoryChannel | null
				const isRecreational = category?.id === RECREATIONAL_CATEGORY_ID

				const { source, roles } = isRecreational
					? { source: "none" as const, roles: [] }
					: getAutoTagSource(
							textChannel.name,
							textChannel.id,
							category?.name ?? null,
							brainMappings,
							serverRoleNames,
						)

				channels.push({
					channelId: textChannel.id,
					channelName: textChannel.name,
					categoryId: category?.id ?? null,
					categoryName: category?.name ?? null,
					autoTagSource: source,
					roles,
					isRecreational,
				})
			})

			// Sort channels by category then name
			channels.sort((a, b) => {
				const catCompare = (a.categoryName ?? "").localeCompare(
					b.categoryName ?? "",
				)
				if (catCompare !== 0) return catCompare
				return a.channelName.localeCompare(b.channelName)
			})

			const data: DashboardData = {
				channels,
				hardcodedMappings: CUSTOM_CHANNEL_ROLE,
				brainMappings,
				recreationalCategoryId: RECREATIONAL_CATEGORY_ID,
			}

			res.json(data)
		} catch (error) {
			robot.logger.error("Error fetching dashboard data:", error)
			res.status(500).json({ error: "Failed to fetch dashboard data" })
		}
	})

	robot.logger.info(
		"Auto-tag dashboard available at /auto-tag-dashboard",
	)
}
