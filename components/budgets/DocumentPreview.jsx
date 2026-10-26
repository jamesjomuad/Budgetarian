import { StyleSheet, View } from 'react-native';

import { fontFamilies } from '../../constants/colors';
import { DOCUMENT_PAGE_HEIGHT, DOCUMENT_PAGE_WIDTH } from '../../utils/budgetExport';
import { Text } from '../ui/Text';

/**
 * Renders one page of the shared document layout model (the same
 * `{ number, items }` pages the PDF writer turns into bytes) as a scaled,
 * absolutely-positioned preview. Because the layout is fully computed before
 * rendering, what the user sees here is the same lines, totals and page
 * breaks the exported PDF carries — only scaled to the screen.
 */
export function DocumentPreview({ page, width, totalPages = 1, showFooter = true }) {
  const scale = width / DOCUMENT_PAGE_WIDTH;
  const height = DOCUMENT_PAGE_HEIGHT * scale;

  return (
    <View
      style={[
        styles.page,
        { width, height, borderRadius: 8 * Math.min(1, scale * 2) },
      ]}
      accessibilityLabel={`Page ${page.number} of ${totalPages}`}
    >
      {page.items.map((item, index) => {
        if (item.type === 'rect') {
          return (
            <View
              key={`rect-${index}`}
              style={{
                position: 'absolute',
                left: item.x * scale,
                top: item.top * scale,
                width: Math.max(1, item.width * scale),
                height: Math.max(1, item.height * scale),
                backgroundColor: item.color,
              }}
            />
          );
        }

        if (item.type === 'line') {
          return (
            <View
              key={`line-${index}`}
              style={{
                position: 'absolute',
                left: Math.min(item.x1, item.x2) * scale,
                top: item.top1 * scale,
                width: Math.max(1, Math.abs(item.x2 - item.x1) * scale),
                height: Math.max(StyleSheet.hairlineWidth, (item.width ?? 1) * scale),
                backgroundColor: item.color,
              }}
            />
          );
        }

        const fontSize = item.size * scale;
        const boxWidth = Math.max(1, (item.width ?? DOCUMENT_PAGE_WIDTH - item.x) * scale);
        return (
          <Text
            key={`text-${index}`}
            numberOfLines={1}
            style={{
              position: 'absolute',
              left: item.x * scale,
              top: item.top * scale,
              width: boxWidth,
              fontSize,
              lineHeight: Math.round(fontSize * 1.2),
              color: item.color,
              textAlign: item.align ?? 'left',
              fontFamily: item.bold ? fontFamilies.bold : fontFamilies.regular,
            }}
          >
            {item.text}
          </Text>
        );
      })}

      {showFooter ? (
        <Text
          style={{
            position: 'absolute',
            left: 0,
            top: (DOCUMENT_PAGE_HEIGHT - 34) * scale,
            width,
            fontSize: 8 * scale,
            color: '#7A867F',
            textAlign: 'center',
            fontFamily: fontFamilies.regular,
          }}
        >
          {`Page ${page.number} of ${totalPages}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
});
