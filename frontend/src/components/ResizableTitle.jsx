import React from 'react';
import { Resizable } from 'react-resizable';

function ResizableTitle(props) {
  const { onResize, width, children, ...restProps } = props;
  if (!width) return <th {...restProps}>{children}</th>;
  return (
    <Resizable width={width} height={0} onResize={onResize} axis="x">
      <th {...restProps}>{children}</th>
    </Resizable>
  );
}

export default ResizableTitle;