import { createContext, useContext, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { hasParents, type ASTNode, type RenderRules } from 'react-native-markdown-display';
import { tableColumnWidths } from './markdown-table';

const TableWidths = createContext<number[] | null>(null);

function TableCell({
  index,
  style,
  children,
}: {
  index: number;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const widths = useContext(TableWidths);
  const width = widths?.[index];
  return (
    <View
      style={[
        style,
        width != null
          ? { width, minWidth: width, maxWidth: width, flexGrow: 0, flexShrink: 0 }
          : { flexGrow: 0, flexShrink: 0 },
      ]}
    >
      {children}
    </View>
  );
}

function listIcon(node: ASTNode, parent: ASTNode[]): string {
  const task = node.attributes?.task;
  if (task === 'checked') return '\u2611';
  if (task === 'open') return '\u2610';
  if (hasParents(parent, 'ordered_list')) {
    const ordered = parent.find((entry) => entry.type === 'ordered_list');
    const start = Number(ordered?.attributes?.start);
    const number = Number.isFinite(start) && start > 0 ? start + node.index : node.index + 1;
    return `${number}${node.markup || '.'}`;
  }
  return Platform.OS === 'android' ? '\u2022' : '\u00B7';
}

/** Task rows, and table cells that share a column width. */
export function markdownBlockRules(): RenderRules {
  return {
    list_item: (node, children, parent, styles, inheritedStyles = {}) => {
      const ordered = hasParents(parent, 'ordered_list');
      const iconStyle = ordered ? styles.ordered_list_icon : styles.bullet_list_icon;
      const contentStyle = ordered
        ? styles._VIEW_SAFE_ordered_list_content
        : styles._VIEW_SAFE_bullet_list_content;
      return (
        <View key={node.key} style={styles._VIEW_SAFE_list_item}>
          <Text style={[inheritedStyles, iconStyle]} accessible={false}>
            {listIcon(node, parent)}
          </Text>
          <View style={contentStyle}>{children}</View>
        </View>
      );
    },
    table: (node, children, _parent, styles) => (
      <TableWidths.Provider key={node.key} value={tableColumnWidths(node)}>
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.table_scroll}
        >
          <View style={[styles._VIEW_SAFE_table, { alignSelf: 'flex-start' }]}>{children}</View>
        </ScrollView>
      </TableWidths.Provider>
    ),
    th: (node, children, _parent, styles) => (
      <TableCell key={node.key} index={node.index} style={styles._VIEW_SAFE_th}>
        {children}
      </TableCell>
    ),
    td: (node, children, _parent, styles) => (
      <TableCell key={node.key} index={node.index} style={styles._VIEW_SAFE_td}>
        {children}
      </TableCell>
    ),
  };
}
