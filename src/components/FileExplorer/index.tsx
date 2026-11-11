import { Label, registerPortalRoot, Text } from '@primer/react'
import { useFocusOnPendingTarget } from 'components/FocusTarget'
import { SidebarContext } from 'components/SidebarContext'
import { LoadingIndicator } from 'components/LoadingIndicator'
import { SearchBar } from 'components/SearchBar'
import { useConfigs } from 'containers/ConfigsContext'
import { useInspector } from 'containers/Inspector'
import { PortalContext } from 'containers/PortalContext'
import { RepoContext } from 'containers/RepoContext'
import { platform, platformName } from 'platforms'
import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { usePrevious, useUpdateEffect } from 'react-use'
import { cx } from 'utils/cx'
import { getSnapshotScrollTop, removeEarlySnapshot } from 'utils/earlySnapshot'
import { run } from 'utils/general'
import { useElementSize } from 'utils/hooks/useElementSize'
import { useAfterRedirect } from 'utils/hooks/useFastRedirect'
import { useLoadedContext } from 'utils/hooks/useLoadedContext'
import { useOnLocationChange } from 'utils/hooks/useOnLocationChange'
import { VisibleNodes, VisibleNodesGenerator } from 'utils/VisibleNodesGenerator'
import { SideBarStateContext } from '../../containers/SideBarState'
import { useGetCurrentPath } from './hooks/useGetCurrentPath'
import { useHandleClickFileLink } from './hooks/useHandleClickFileLink'
import { useHandleKeyDown } from './hooks/useHandleKeyDown'
import {
  NodeRenderer,
  useNodeRenderers,
  useRenderFileCommentAmounts,
  useRenderFileStatus,
  useRenderFindInFolderButton,
  useRenderGoToButton,
  useRenderMoreActions,
} from './hooks/useNodeRenderers'
import { useHandleNodeClick } from './hooks/useOnNodeClick'
import { useOnSearch } from './hooks/useOnSearch'
import { usePersistExpandedFolders } from './hooks/usePersistExpandedFolders'
import { useRenderLabelText } from './hooks/useRenderLabelText'
import { useVisibleNodesGenerator } from './hooks/useVisibleNodesGenerator'
import { useVisibleNodesGeneratorMethods } from './hooks/useVisibleNodesGeneratorMethods'
import { Node } from './Node'
import { useHandleNodeFocus } from './useHandleNodeFocus'
import { AlignMode, useVirtualScroll } from './useVirtualScroll'
import { useVisibleNodes } from './useVisibleNodes'

export type NodeRendererContext = {
  onNodeClick: (event: React.MouseEvent<HTMLElement, MouseEvent>, node: TreeNode) => void
  onNodeFocus: (event: React.FocusEvent<HTMLElement, Element>, node: TreeNode) => void
  renderLabelText: NodeRenderer
  renderActions: NodeRenderer | undefined
  visibleNodes: VisibleNodes
}

export function FileExplorer() {
  const metaData = useContext(RepoContext)
  const visibleNodesGenerator = useVisibleNodesGenerator(metaData)
  const visibleNodes = useVisibleNodes(visibleNodesGenerator)
  const state = useLoadedContext(SideBarStateContext).value

  platform.usePlatformFileTreeHooks?.({ visibleNodesGenerator })

  return (
    <>
      {run(() => {
        switch (state) {
          case 'tree-loading':
            return <LoadingIndicator text={'Fetching File List...'} />
          case 'tree-rendering':
            return <LoadingIndicator text={'Rendering File List...'} />
          case 'tree-rendered':
            return (
              metaData &&
              visibleNodesGenerator &&
              visibleNodes && (
                <LoadedFileExplorer
                  metaData={metaData}
                  visibleNodesGenerator={visibleNodesGenerator}
                  visibleNodes={visibleNodes}
                />
              )
            )
        }
      })}
    </>
  )
}

function LoadedFileExplorer({
  metaData,
  visibleNodesGenerator,
  visibleNodes,
}: {
  metaData: MetaData
  visibleNodesGenerator: VisibleNodesGenerator
  visibleNodes: VisibleNodes
}) {
  const config = useConfigs().value

  const [searchKey, updateSearchKey] = useState('')
  const searched = !!searchKey
  const onSearch = useOnSearch(updateSearchKey, visibleNodesGenerator)
  const { focusedNode, nodes, expandedNodes, depths, loading } = visibleNodes

  // re-search when the compress option update
  const { compressSingletonFolder } = config
  useUpdateEffect(() => {
    visibleNodesGenerator.setCompression(compressSingletonFolder)
  }, [compressSingletonFolder])

  // Gitea/Forgejo reload the page per file: continue at the previous scroll offset
  const [restoredScrollTop] = useState(() =>
    platformName === 'Gitea' ? getSnapshotScrollTop() : null,
  )
  const {
    ref: filesRef,
    size: [, height],
  } = useElementSize<HTMLDivElement>()
  const { compactFileTree } = config
  const {
    ref: scrollElementRef,
    onScroll,
    visibleRows,
    containerStyle,
    scrollToItem,
  } = useVirtualScroll<HTMLDivElement>({
    totalAmount: visibleNodes.nodes.length,
    rowHeight: compactFileTree ? 24 : 37,
    viewportHeight: height,
    overScan: 10,
    initialScrollTop: restoredScrollTop ?? 0,
  })

  const portalName = useMemo(() => `${Math.random()}`, [])
  useEffect(() => {
    const current = scrollElementRef.current
    if (current) registerPortalRoot(current, portalName)
  }, [scrollElementRef, portalName])

  // - init loading
  //   - "top"
  // - jump to file
  //   - "top"
  // - tab to file
  //   - "lazy"
  // - click file/folder
  //   - "lazy"
  // - navigate with keyboard
  //   - "lazy"
  // when continuing at a restored offset, only scroll if the current file is out of view
  const [alignMode, setAlignMode] = useState<AlignMode>(restoredScrollTop ? 'lazy' : 'top')

  const index = useMemo(
    () => (focusedNode?.path ? nodes.findIndex(node => node.path === focusedNode.path) : -1),
    [focusedNode?.path, nodes],
  )

  useLayoutEffect(() => {
    if (index !== -1) scrollToItem(index, alignMode)
  }, [index, scrollToItem, alignMode])

  // Uncover the real tree once it shows the current file (or there is none),
  // a frame after it has painted underneath the early snapshot.
  const [expectsCurrentFile] = useState(
    () => (platform.getCurrentPath(metaData.branchName)?.length || 0) > 0,
  )
  const treeReady = visibleNodes.nodes.length > 0 && (Boolean(focusedNode) || !expectsCurrentFile)
  useEffect(() => {
    if (!treeReady) return
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(removeEarlySnapshot)))
    return () => cancelAnimationFrame(frame)
  }, [treeReady])
  const prevSearchKey = usePrevious(searchKey)
  useEffect(() => {
    // when start searching or stop searching
    if (!prevSearchKey !== !searchKey) scrollToItem(0, alignMode)
  }, [prevSearchKey, searchKey, scrollToItem, alignMode])

  const getCurrentPath = useGetCurrentPath(metaData)
  const methods = useVisibleNodesGeneratorMethods(
    visibleNodesGenerator,
    getCurrentPath,
    updateSearchKey,
  )
  const { expandTo, goTo, focusNode } = methods
  // after the methods hook: its mount effect resets expansion via goTo, so the
  // restore has to run later
  usePersistExpandedFolders(visibleNodesGenerator, metaData)
  const handleNodeFocus = useHandleNodeFocus(methods, setAlignMode)
  const handleNodeClick = useHandleNodeClick(methods, setAlignMode)
  const handleKeyDown = useHandleKeyDown(visibleNodes, methods, searched, setAlignMode)
  const handleFocusSearchBar = useCallback(() => focusNode(null), [focusNode])

  const renderActions = useNodeRenderers([
    useRenderGoToButton(searched, goTo),
    useRenderFindInFolderButton(onSearch),
    useRenderFileCommentAmounts(),
    useRenderMoreActions(methods),
    useRenderFileStatus(),
  ])
  const renderLabelText = useRenderLabelText(searchKey)

  const goToCurrentItem = useCallback(() => {
    const targetPath = getCurrentPath()
    if (targetPath) expandTo(targetPath)
  }, [getCurrentPath, expandTo])

  useOnLocationChange(goToCurrentItem)
  useAfterRedirect(goToCurrentItem)

  const [currentPath, setCurrentPath] = useState(() => getCurrentPath())
  useAfterRedirect(useCallback(() => setCurrentPath(getCurrentPath()), [getCurrentPath]))
  useInspector('CurrentPath', currentPath)

  const ref = useRef<HTMLDivElement | null>(null)
  useFocusOnPendingTarget(
    'files',
    useCallback(() => ref.current?.focus(), []),
  )
  useRetainTreeFocusDuringKeyboardNav(ref)

  useHandleClickFileLink(ref)

  return (
    <div ref={ref} className={`file-explorer`} tabIndex={-1} onKeyDown={handleKeyDown}>
      {visibleNodesGenerator?.defer && (
        <div className={'status'}>
          <Label
            title="This repository is large. Gitako has switched to Lazy Mode to improve performance. Folders will be loaded on demand."
            className={'lazy-mode'}
            variant="attention"
          >
            Lazy Mode is ON
          </Label>
        </div>
      )}
      <SearchBar value={searchKey} onSearch={onSearch} onFocus={handleFocusSearchBar} />
      {searched && visibleNodes.nodes.length === 0 && (
        <>
          <Text marginTop={6} textAlign="center" color="text.gray">
            No results found.
          </Text>
          {visibleNodesGenerator?.defer && (
            <Text textAlign="center" color="gray.4" fontSize="12px">
              Search results are limited to loaded folders in Lazy Mode.
            </Text>
          )}
        </>
      )}
      <div
        className={cx('files', {
          // instead of unmounting, hide the element when not needed, so that the ref can be preserved after search result matches nothing
          hidden: visibleNodes.nodes.length === 0,
        })}
        ref={filesRef}
      >
        <div
          style={{
            height,
            width: '100%',
            overflow: 'auto',
            position: 'absolute', // This allows reducing `height` on viewport height reduce
          }}
          ref={scrollElementRef}
          onScroll={onScroll}
          tabIndex={-1} // prevent getting focus via tab key on GitHub
        >
          <PortalContext.Provider value={portalName}>
            <div style={containerStyle}>
              {visibleRows
                .map(({ row, style }) => ({
                  node: nodes[row],
                  style,
                }))
                .map(({ node, style }) => (
                  <Node
                    key={node.path}
                    node={node}
                    style={style}
                    depth={depths.get(node) || 0}
                    focused={focusedNode?.path === node.path}
                    loading={loading.has(node.path)}
                    expanded={expandedNodes.has(node.path)}
                    onClick={handleNodeClick}
                    onFocus={handleNodeFocus}
                    renderLabelText={renderLabelText}
                    renderActions={renderActions}
                  />
                ))}
            </div>
          </PortalContext.Provider>
        </div>
      </div>
    </div>
  )
}

// Keyboard navigation must keep focus in the tree so the user can keep arrowing
// through files. Some opens drop focus onto <body> without any element claiming
// it — most notably opening a file on a PR's changed-files view, which is an
// in-page diff scroll (#diff-<digest>) where the browser moves focus off the
// tree as part of fragment navigation rather than a real page load. When that
// happens during an active keyboard-nav session we pull focus back. We only act
// when focus actually landed on <body>, checked on the next frame so the host's
// own focus moves have settled: if a real element took focus, leave it. The
// session flag is set by the keydown handler and cleared on mousedown, so mouse
// opens opt out. The remount case (tree torn down and rebuilt) is handled
// instead by pendingFocusTarget, which survives at the Sidebar level.
function useRetainTreeFocusDuringKeyboardNav(ref: React.RefObject<HTMLElement>) {
  const { keyboardNavRef } = useContext(SidebarContext)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onFocusOut = () => {
      if (!keyboardNavRef.current) return
      requestAnimationFrame(() => {
        if (keyboardNavRef.current && document.activeElement === document.body) {
          ref.current?.focus()
        }
      })
    }
    el.addEventListener('focusout', onFocusOut)
    return () => el.removeEventListener('focusout', onFocusOut)
  }, [ref, keyboardNavRef])
}
