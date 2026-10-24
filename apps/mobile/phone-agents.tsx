import type { ComponentProps } from 'react';
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  CreateChatSheet,
  type CreateMode,
} from './chat-ui';
import { FilterGlyph, ProjectGlyph, WorktreeStatusIcon, worktreeStatusKind } from './sidebar-icons';
import {
  AddButton,
  BrandMark,
  ChatRow,
  type PhoneChat,
  type PhonePrBadge,
  PrBadge,
  TagChip,
} from './phone-chrome';
import { palette, styles } from './styles';

export type PhoneWorktree = {
  label: string;
  chats: PhoneChat[];
  tags?: string[];
  badge?: PhonePrBadge;
  blockedBy?: string[];
};

export type PhoneProject = {
  name: string;
  path: string;
  worktrees: PhoneWorktree[];
};

export function PhoneAgentsScreen({
  deviceLabel,
  error,
  showOrchestration,
  orchestration,
  pendingAdd,
  filterOpen,
  onToggleFilter,
  query,
  onQuery,
  tagChoices,
  tagFilters,
  onToggleTag,
  onClearTags,
  filtering,
  projects,
  onOpenCreate,
  onOpenChat,
  onArchiveChat,
  onDesktops,
  onHistory,
  create,
}: {
  deviceLabel: string;
  error: string | null;
  showOrchestration: boolean;
  orchestration: PhoneChat[];
  pendingAdd: string | null;
  filterOpen: boolean;
  onToggleFilter: () => void;
  query: string;
  onQuery: (value: string) => void;
  tagChoices: string[];
  tagFilters: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  filtering: boolean;
  projects: PhoneProject[];
  onOpenCreate: (mode: CreateMode) => void;
  onOpenChat: (chatId: string) => void;
  onArchiveChat: (chatId: string) => void;
  onDesktops: () => void;
  onHistory: () => void;
  create: ComponentProps<typeof CreateChatSheet> | null;
}) {
  const tagsOn = filterOpen || tagFilters.length > 0;
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.chrome}>
        <BrandMark />
        <Text style={styles.chromeTitle} numberOfLines={1}>
          {deviceLabel}
        </Text>
        <Pressable onPress={onDesktops} hitSlop={8}>
          <Text style={styles.link}>Desktops</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.transcript} contentContainerStyle={styles.listPad} keyboardShouldPersistTaps="handled">
        {showOrchestration ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>Orchestration</Text>
              <AddButton
                label="New agent"
                hint="Add orchestration agent"
                busy={pendingAdd === 'orchestration'}
                onPress={() => onOpenCreate({ kind: 'orchestration' })}
              />
            </View>
            {orchestration.length === 0 ? <Text style={styles.meta}>No agents yet</Text> : null}
            {orchestration.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                onOpen={() => onOpenChat(chat.id)}
                onArchive={() => onArchiveChat(chat.id)}
              />
            ))}
          </>
        ) : null}
        <View style={[styles.sectionRow, styles.projectsHead]}>
          <Text style={styles.sectionLabel}>Projects</Text>
          <Pressable
            style={[styles.filterBtn, tagsOn && styles.filterBtnOn]}
            onPress={onToggleFilter}
            accessibilityRole="button"
            accessibilityLabel="Filter projects and tags"
            accessibilityState={{ expanded: filterOpen }}
          >
            <FilterGlyph active={tagsOn} />
          </Pressable>
        </View>
        {filterOpen ? (
          <View style={styles.filterPanel}>
            <TextInput
              style={styles.input}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Filter projects and tags…"
              placeholderTextColor={palette.muted}
              value={query}
              onChangeText={onQuery}
            />
            {tagChoices.length > 0 ? (
              <View
                style={styles.tagChoices}
                accessibilityLabel="Filter by tags. A workspace must have every selected tag."
              >
                {tagChoices.map((tag) => (
                  <TagChip
                    key={tag.toLowerCase()}
                    tag={tag}
                    selected={tagFilters.some((item) => item.toLowerCase() === tag.toLowerCase())}
                    filtering={tagFilters.length > 0}
                    onPress={() => onToggleTag(tag)}
                  />
                ))}
                {tagFilters.length > 0 ? (
                  <Pressable onPress={onClearTags} accessibilityRole="button" accessibilityLabel="Clear tags">
                    <Text style={styles.clearTags}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
        {!filterOpen && tagFilters.length > 0 ? (
          <View style={styles.taggedRow}>
            <Text style={styles.taggedLabel}>Tagged</Text>
            {tagFilters.map((tag) => (
              <TagChip
                key={tag.toLowerCase()}
                tag={tag}
                selected
                filtering
                remove
                onPress={() => onToggleTag(tag)}
              />
            ))}
            {tagFilters.length > 1 ? (
              <Pressable onPress={onClearTags} accessibilityRole="button" accessibilityLabel="Clear tags">
                <Text style={styles.clearTags}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {projects.length === 0 ? (
          <Text style={styles.meta}>{filtering ? 'Nothing matched' : 'No projects yet'}</Text>
        ) : null}
        {projects.map((project) => (
          <View key={project.path} style={styles.projectBlock}>
            <View style={styles.sectionRow}>
              <View style={styles.glyphRow}>
                <ProjectGlyph />
                <Text style={styles.projectName} numberOfLines={1}>
                  {project.name}
                </Text>
              </View>
              <AddButton
                label="New workspace"
                hint={`New workspace in ${project.name}`}
                busy={pendingAdd === `project:${project.path}`}
                onPress={() => onOpenCreate({ kind: 'project', repoPath: project.path, name: project.name })}
              />
            </View>
            {project.worktrees.length === 0 ? <Text style={styles.meta}>No workspaces</Text> : null}
            {project.worktrees.map((worktree) => {
              const anchor = worktree.chats[0];
              return (
                <View key={`${project.path}:${worktree.label}`} style={styles.worktreeBlock}>
                  <View
                    style={[
                      styles.sectionRow,
                      styles.worktreeHead,
                      worktree.tags?.length || worktree.blockedBy?.length ? styles.worktreeHeadTagged : null,
                    ]}
                  >
                    <View style={styles.worktreeIdentity}>
                      <View style={styles.worktreeTitle}>
                        <WorktreeStatusIcon kind={worktreeStatusKind(worktree.chats)} />
                        <Text style={styles.worktreeName} numberOfLines={1}>
                          {worktree.label}
                        </Text>
                        {worktree.badge ? <PrBadge badge={worktree.badge} /> : null}
                      </View>
                      {worktree.blockedBy?.length ? (
                        <Text style={styles.blockedBy} numberOfLines={1}>
                          {`Blocked by ${worktree.blockedBy.join(', ')}`}
                        </Text>
                      ) : null}
                      {worktree.tags?.length ? (
                        <View style={styles.tagRow}>
                          {worktree.tags.map((tag) => (
                            <TagChip
                              key={tag}
                              tag={tag}
                              selected={tagFilters.some((item) => item.toLowerCase() === tag.toLowerCase())}
                              filtering={tagFilters.length > 0}
                              onPress={() => onToggleTag(tag)}
                            />
                          ))}
                        </View>
                      ) : null}
                    </View>
                    {anchor ? (
                      <AddButton
                        label="Add agent"
                        hint={`Add agent to ${worktree.label}`}
                        busy={pendingAdd === `worktree:${anchor.id}`}
                        onPress={() => onOpenCreate({ kind: 'worktree', chatId: anchor.id, label: worktree.label })}
                      />
                    ) : null}
                  </View>
                  {worktree.chats.map((chat) => (
                    <ChatRow
                      key={chat.id}
                      chat={chat}
                      onOpen={() => onOpenChat(chat.id)}
                      onArchive={() => onArchiveChat(chat.id)}
                    />
                  ))}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
      {error ? <Text style={[styles.error, styles.errorPad]}>{error}</Text> : null}
      <View style={styles.footer}>
        <Pressable style={styles.historyButton} onPress={onHistory} accessibilityRole="button">
          <Text style={styles.link}>Archived chats</Text>
        </Pressable>
      </View>
      {create ? <CreateChatSheet {...create} /> : null}
    </SafeAreaView>
  );
}
