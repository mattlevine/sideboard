import { Text, View } from 'react-native';
import { styles } from './styles';

/** Empty transcript for a project worktree or an orchestration chat. */
export function EmptyChat({ project }: { project: boolean }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyMark}>
        <View style={styles.emptyPlate} />
        <View style={styles.emptyCube} />
      </View>
      <Text style={styles.emptyTitle}>{project ? 'What should we work on?' : 'What should we orchestrate?'}</Text>
      <Text style={styles.emptyBody}>
        {project
          ? 'This agent stays on this worktree on the Mac.'
          : 'Steer worktree agents across registered repos. They stay on this Mac.'}
      </Text>
    </View>
  );
}
